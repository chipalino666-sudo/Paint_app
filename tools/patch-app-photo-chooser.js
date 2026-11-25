'use strict';

/*
 * Приложение: нормальный выбор фото (камера или галерея) + проверка обновлений
 * при каждом запуске.
 *
 *   node tools/patch-app-photo-chooser.js
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const javaDir = path.join(root, 'android', 'Lonjeron', 'src', 'ru', 'lonjeron', 'app');
const mainFile = path.join(javaDir, 'MainActivity.java');
const manifestFile = path.join(root, 'android', 'Lonjeron', 'AndroidManifest.xml');

let java = fs.readFileSync(mainFile, 'utf8').replace(/\r\n/g, '\n');
let changed = 0;

/* ---------- 1. Поля для выбора файла ---------- */

if (!java.includes('pendingCameraUri')) {
  java = java.replace(
    '    private ValueCallback<Uri[]> filePathCallback;',
    [
      '    private ValueCallback<Uri[]> filePathCallback;',
      '    private Uri pendingCameraUri;',
      '',
      '    private static final int CAMERA_REQ = 1002;',
      '    private static final int GALLERY_REQ = 1003;'
    ].join('\n')
  );

  changed++;
  console.log('поля для камеры и галереи');
}

/* ---------- 2. Импорты ---------- */

java = java.replace(
  'import android.content.pm.PackageManager;',
  [
    'import android.content.ContentValues;',
    'import android.content.pm.PackageManager;',
    'import android.provider.MediaStore;'
  ].join('\n')
);

/* ---------- 3. Свой выбор: «Снять фото» / «Выбрать файл» ---------- */

const oldChooser = [
  '            @Override',
  '            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,',
  '                                             FileChooserParams params) {',
  '                if (filePathCallback != null) {',
  '                    filePathCallback.onReceiveValue(null);',
  '                }',
  '',
  '                filePathCallback = callback;',
  '',
  '                try {',
  '                    Intent intent = params.createIntent();',
  '                    startActivityForResult(intent, FILE_REQ);',
  '                    return true;',
  '                } catch (Exception error) {',
  '                    filePathCallback = null;',
  '                    Toast.makeText(MainActivity.this, "Не удалось открыть выбор файла", Toast.LENGTH_SHORT).show();',
  '                    return false;',
  '                }',
  '            }'
].join('\n');

const newChooser = [
  '            @Override',
  '            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,',
  '                                             FileChooserParams params) {',
  '                if (filePathCallback != null) {',
  '                    filePathCallback.onReceiveValue(null);',
  '                }',
  '',
  '                filePathCallback = callback;',
  '',
  '                // Своё меню: на разных телефонах системный выбор файла работает по-разному',
  '                new AlertDialog.Builder(MainActivity.this)',
  '                        .setTitle("Добавить фотографию")',
  '                        .setItems(new String[] { "Снять на камеру", "Выбрать из галереи" },',
  '                                (dialog, which) -> {',
  '                                    if (which == 0) openCamera();',
  '                                    else openGallery();',
  '                                })',
  '                        .setNegativeButton("Отмена", (dialog, which) -> cancelFileChoice())',
  '                        .setOnCancelListener(dialog -> cancelFileChoice())',
  '                        .show();',
  '',
  '                return true;',
  '            }'
].join('\n');

if (java.includes(oldChooser)) {
  java = java.replace(oldChooser, newChooser);
  changed++;
  console.log('onShowFileChooser: своё меню');
}

/* ---------- 4. Методы камеры и галереи ---------- */

if (!java.includes('private void openCamera()')) {
  const anchor = '    @Override\n    protected void onActivityResult(int requestCode, int resultCode, Intent data) {';

  const methods = [
    '    private void cancelFileChoice() {',
    '        if (filePathCallback != null) {',
    '            filePathCallback.onReceiveValue(null);',
    '            filePathCallback = null;',
    '        }',
    '    }',
    '',
    '    /** Съёмка на камеру: снимок сразу попадает в галерею и отдаётся странице. */',
    '    private void openCamera() {',
    '        try {',
    '            ContentValues values = new ContentValues();',
    '            values.put(MediaStore.Images.Media.DISPLAY_NAME, "lonjeron-" + System.currentTimeMillis() + ".jpg");',
    '            values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");',
    '',
    '            pendingCameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);',
    '',
    '            Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);',
    '',
    '            if (pendingCameraUri != null) {',
    '                intent.putExtra(MediaStore.EXTRA_OUTPUT, pendingCameraUri);',
    '                intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);',
    '            }',
    '',
    '            startActivityForResult(intent, CAMERA_REQ);',
    '        } catch (Exception error) {',
    '            cancelFileChoice();',
    '            Toast.makeText(this, "Камера недоступна: " + error.getMessage(), Toast.LENGTH_LONG).show();',
    '        }',
    '    }',
    '',
    '    /** Галерея: системный выбор файла, но с явной категорией «открыть». */',
    '    private void openGallery() {',
    '        try {',
    '            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);',
    '            intent.addCategory(Intent.CATEGORY_OPENABLE);',
    '            intent.setType("image/*");',
    '',
    '            startActivityForResult(Intent.createChooser(intent, "Выберите фотографию"), GALLERY_REQ);',
    '        } catch (Exception error) {',
    '            cancelFileChoice();',
    '            Toast.makeText(this, "Не удалось открыть галерею", Toast.LENGTH_LONG).show();',
    '        }',
    '    }',
    '',
    anchor
  ].join('\n');

  java = java.replace(anchor, methods);
  changed++;
  console.log('методы камеры и галереи');
}

/* ---------- 5. Обработка результата ---------- */

const oldResult = [
  '    @Override',
  '    protected void onActivityResult(int requestCode, int resultCode, Intent data) {',
  '        if (requestCode == FILE_REQ) {',
  '            if (filePathCallback == null) return;',
  '',
  '            Uri[] result = null;',
  '',
  '            if (resultCode == RESULT_OK && data != null) {',
  '                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);',
  '            }',
  '',
  '            filePathCallback.onReceiveValue(result);',
  '            filePathCallback = null;',
  '            return;',
  '        }',
  '',
  '        super.onActivityResult(requestCode, resultCode, data);',
  '    }'
].join('\n');

const newResult = [
  '    @Override',
  '    protected void onActivityResult(int requestCode, int resultCode, Intent data) {',
  '        if (requestCode == CAMERA_REQ) {',
  '            if (filePathCallback == null) return;',
  '',
  '            Uri[] result = null;',
  '',
  '            if (resultCode == RESULT_OK) {',
  '                if (pendingCameraUri != null) result = new Uri[] { pendingCameraUri };',
  '                else if (data != null) result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);',
  '            }',
  '',
  '            filePathCallback.onReceiveValue(result);',
  '            filePathCallback = null;',
  '            pendingCameraUri = null;',
  '            return;',
  '        }',
  '',
  '        if (requestCode == GALLERY_REQ || requestCode == FILE_REQ) {',
  '            if (filePathCallback == null) return;',
  '',
  '            Uri[] result = null;',
  '',
  '            if (resultCode == RESULT_OK && data != null) {',
  '                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);',
  '',
  '                if (result == null && data.getData() != null) result = new Uri[] { data.getData() };',
  '            }',
  '',
  '            filePathCallback.onReceiveValue(result);',
  '            filePathCallback = null;',
  '            return;',
  '        }',
  '',
  '        super.onActivityResult(requestCode, resultCode, data);',
  '    }'
].join('\n');

if (java.includes(oldResult)) {
  java = java.replace(oldResult, newResult);
  changed++;
  console.log('onActivityResult: камера и галерея');
}

/* ---------- 6. Проверка обновлений при каждом запуске ---------- */

if (!java.includes('checkUpdateOnResume')) {
  java = java.replace(
    '    @Override\n    protected void onResume() {',
    [
      '    private long lastUpdateCheck = 0;',
      '',
      '    /** Проверяем обновления при запуске, но не чаще раза в 6 часов. */',
      '    private void checkUpdateOnResume() {',
      '        long now = System.currentTimeMillis();',
      '',
      '        if (now - lastUpdateCheck < 6 * 60 * 60 * 1000L) return;',
      '',
      '        lastUpdateCheck = now;',
      '        checkForUpdate();',
      '    }',
      '',
      '    @Override',
      '    protected void onResume() {'
    ].join('\n')
  );

  java = java.replace(
    '        markNotificationsRead();\n    }',
    '        markNotificationsRead();\n        checkUpdateOnResume();\n    }'
  );

  changed++;
  console.log('проверка обновлений при запуске');
}

fs.writeFileSync(mainFile, java);

/* ---------- 7. Версия 1.5 ---------- */

let manifest = fs.readFileSync(manifestFile, 'utf8').replace(/\r\n/g, '\n');
manifest = manifest.replace('android:versionCode="4"', 'android:versionCode="5"');
manifest = manifest.replace('android:versionName="1.4"', 'android:versionName="1.5"');
fs.writeFileSync(manifestFile, manifest);
console.log('версия: 1.5 (код 5)');

console.log('изменений:', changed);
