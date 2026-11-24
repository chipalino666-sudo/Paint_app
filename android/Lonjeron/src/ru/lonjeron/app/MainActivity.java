package ru.lonjeron.app;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Message;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Лонжерон — приложение цеха.
 *
 * Простая оболочка вокруг сайта: свой значок, без адресной строки,
 * с загрузкой файлов (фото, камеры) и скачиванием документов.
 */
public class MainActivity extends Activity {

    private static final String START_URL = "https://ceh-lonjeron.ru/";
    private static final int FILE_REQ = 1001;

    private WebView web;
    private ProgressBar bar;
    private TextView offline;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.parseColor("#0b1120"));
        window.setNavigationBarColor(Color.parseColor("#0b1120"));

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0b1120"));

        web = new WebView(this);
        FrameLayout.LayoutParams webParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(web, webParams);

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        root.addView(bar, barParams);

        offline = new TextView(this);
        offline.setText("Нет связи с сервером.\nПроверьте интернет и нажмите сюда, чтобы попробовать снова.");
        offline.setTextColor(Color.parseColor("#c7d2e5"));
        offline.setTextSize(16);
        offline.setGravity(android.view.Gravity.CENTER);
        offline.setVisibility(View.GONE);
        offline.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                offline.setVisibility(View.GONE);
                web.reload();
            }
        });
        FrameLayout.LayoutParams offParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        root.addView(offline, offParams);

        setContentView(root);

        setupWeb();
        web.loadUrl(START_URL);
    }

    private int dp(int value) {
        return Math.round(getResources().getDisplayMetrics().density * value);
    }

    private void setupWeb() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(true);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            WebView.setWebContentsDebuggingEnabled(false);
        }

        String agent = s.getUserAgentString();
        s.setUserAgentString(agent + " LonjeronApp/1.0");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookies.setAcceptThirdPartyCookies(web, true);
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                bar.setVisibility(View.GONE);
                offline.setVisibility(View.GONE);
        offline.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                offline.setVisibility(View.GONE);
                web.reload();
            }
        });
                CookieManager.getInstance().flush();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showOffline();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                if (progress < 100) {
                    bar.setVisibility(View.VISIBLE);
                    bar.setProgress(progress);
                } else {
                    bar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }

                filePathCallback = callback;

                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_REQ);
                    return true;
                } catch (Exception error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла", Toast.LENGTH_SHORT).show();
                    return false;
                }
            }

            /** Ссылки с target="_blank" открываем в этом же окне. */
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView temp = new WebView(MainActivity.this);
                temp.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                        web.loadUrl(request.getUrl().toString());
                        temp.destroy();
                        return true;
                    }

                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, String url) {
                        web.loadUrl(url);
                        temp.destroy();
                        return true;
                    }
                });

                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(temp);
                resultMsg.sendToTarget();
                return true;
            }
        });

        // Документы (ТДС, паспорта) скачиваем системным менеджером загрузок
        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.addRequestHeader("User-Agent", userAgent);

                    String cookie = CookieManager.getInstance().getCookie(url);
                    if (cookie != null) request.addRequestHeader("Cookie", cookie);

                    request.setMimeType(mimeType);
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,
                            android.webkit.URLUtil.guessFileName(url, contentDisposition, mimeType));

                    DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    manager.enqueue(request);

                    Toast.makeText(MainActivity.this, "Документ сохраняется в «Загрузки»", Toast.LENGTH_LONG).show();
                } catch (Exception error) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                }
            }
        });
    }

    /** Внешние ссылки — в браузер, свои — внутри приложения. */
    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;

        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();

        if (scheme.equals("tel") || scheme.equals("mailto") || scheme.equals("whatsapp")
                || scheme.equals("tg")) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception error) {
                Toast.makeText(this, "Нет приложения для этой ссылки", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        if (host.endsWith("ceh-lonjeron.ru") || host.equals("127.0.0.1") || host.equals("localhost")) {
            return false;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception error) {
            return false;
        }

        return true;
    }

    private void showOffline() {
        if (isOnline()) return;

        bar.setVisibility(View.GONE);
        offline.setVisibility(View.VISIBLE);
    }

    private boolean isOnline() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo info = cm.getActiveNetworkInfo();
            return info != null && info.isConnected();
        } catch (Exception error) {
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ) {
            if (filePathCallback == null) return;

            Uri[] result = null;

            if (resultCode == RESULT_OK && data != null) {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }

            filePathCallback.onReceiveValue(result);
            filePathCallback = null;
            return;
        }

        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }

        super.onBackPressed();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.loadUrl("about:blank");
            web.destroy();
        }
        super.onDestroy();
    }
}
