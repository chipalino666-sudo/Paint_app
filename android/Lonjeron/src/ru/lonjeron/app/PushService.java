package ru.lonjeron.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.os.IBinder;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Фоновая служба уведомлений.
 *
 * Держит соединение с сервером Лонжерона и показывает уведомления,
 * когда появляется новый заказ, меняется статус или заканчивается материал.
 * Работает без Firebase и Google-аккаунта.
 */
public class PushService extends Service {

    static final String BASE = "https://ceh-lonjeron.ru";
    static final String CHANNEL_SERVICE = "lonjeron_service";
    static final String CHANNEL_EVENTS = "lonjeron_events";

    private static final int FOREGROUND_ID = 1;
    private static final int EVENT_ID_BASE = 1000;

    private Thread worker;
    private volatile boolean running = true;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        startForeground(FOREGROUND_ID, serviceNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (worker == null || !worker.isAlive()) {
            worker = new Thread(this::loop, "lonjeron-push");
            worker.start();
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    /* ------------------------------------------------------------------ */

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        NotificationChannel service = new NotificationChannel(
                CHANNEL_SERVICE, "Связь с цехом", NotificationManager.IMPORTANCE_MIN);
        service.setDescription("Тихая строка, без неё не приходят уведомления");
        service.setShowBadge(false);
        manager.createNotificationChannel(service);

        NotificationChannel events = new NotificationChannel(
                CHANNEL_EVENTS, "Заказы и материалы", NotificationManager.IMPORTANCE_HIGH);
        events.setDescription("Новые заказы, смена статуса, остатки на складе");
        events.enableVibration(true);
        manager.createNotificationChannel(events);
    }

    private Notification serviceNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pending = PendingIntent.getActivity(this, 0, open, pendingFlags());

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_SERVICE)
                : new Notification.Builder(this);

        return builder
                .setContentTitle("Лонжерон на связи")
                .setContentText("Уведомления о заказах включены")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setPriority(Notification.PRIORITY_MIN)
                .setOngoing(true)
                .setContentIntent(pending)
                .build();
    }

    private int pendingFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    /* ------------------------------------------------------------------ */

    private void loop() {
        SharedPreferences prefs = getSharedPreferences("lonjeron_push", Context.MODE_PRIVATE);
        long since = prefs.getLong("since", 0);

        while (running) {
            HttpURLConnection connection = null;

            try {
                String cookie = CookieManager.getInstance().getCookie(BASE);

                if (cookie == null || cookie.isEmpty()) {
                    // Ещё не вошли — ждём и пробуем снова
                    Thread.sleep(10000);
                    continue;
                }

                URL url = new URL(BASE + "/api/push/watch?since=" + since + "&timeout=25");
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setRequestProperty("Cookie", cookie);
                connection.setRequestProperty("User-Agent", "LonjeronApp/1.3");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(40000);
                connection.setUseCaches(false);

                int code = connection.getResponseCode();

                if (code == 401 || code == 403) {
                    Thread.sleep(15000);
                    continue;
                }

                if (code != 200) {
                    Thread.sleep(8000);
                    continue;
                }

                StringBuilder text = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) text.append(line);
                }

                JSONObject data = new JSONObject(text.toString());
                JSONArray events = data.optJSONArray("events");

                if (events != null && events.length() > 0) {
                    for (int i = 0; i < events.length(); i++) {
                        JSONObject event = events.getJSONObject(i);
                        showEvent(event);
                    }

                    since = data.optLong("last", since);
                    prefs.edit().putLong("since", since).apply();
                } else {
                    long last = data.optLong("last", since);
                    if (last > since) {
                        since = last;
                        prefs.edit().putLong("since", since).apply();
                    }
                }
            } catch (InterruptedException stop) {
                return;
            } catch (Exception error) {
                try {
                    Thread.sleep(10000);
                } catch (InterruptedException stop) {
                    return;
                }
            } finally {
                if (connection != null) connection.disconnect();
            }
        }
    }

    private void showEvent(JSONObject event) {
        try {
            String title = event.optString("title", "Лонжерон");
            String body = event.optString("body", "");
            int id = event.optInt("id", EVENT_ID_BASE);

            Intent open = new Intent(this, MainActivity.class);
            open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

            PendingIntent pending = PendingIntent.getActivity(this, id, open, pendingFlags());

            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? new Notification.Builder(this, CHANNEL_EVENTS)
                    : new Notification.Builder(this);

            Bitmap large = appIcon();

            builder.setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new Notification.BigTextStyle().bigText(body))
                    .setSmallIcon(android.R.drawable.stat_notify_chat)
                    .setAutoCancel(true)
                    .setContentIntent(pending);

            if (large != null) builder.setLargeIcon(large);

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                builder.setPriority(Notification.PRIORITY_HIGH);
                builder.setDefaults(Notification.DEFAULT_ALL);
            } else {
                builder.setCategory(Notification.CATEGORY_MESSAGE);
            }

            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            manager.notify(EVENT_ID_BASE + id, builder.build());
        } catch (Exception error) {
            /* одно сломанное событие не должно останавливать службу */
        }
    }

    private Bitmap appIcon() {
        try {
            int resId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
            return resId == 0 ? null : BitmapFactory.decodeResource(getResources(), resId);
        } catch (Exception error) {
            return null;
        }
    }
}
