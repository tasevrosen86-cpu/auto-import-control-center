package bg.royalcars.aicc;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Fetches the draft's photos into the app's private cache.
 *
 * A WebView file chooser accepts only local content URIs, so remote photo URLs
 * have to be on the device before Mobile.bg's upload field can be answered at
 * all. Files are written under cacheDir/photos and exposed one by one through
 * {@link PhotoProvider}, which grants read access per URI.
 *
 * Photos already present are reused, so re-staging the same draft does not
 * download them twice. A single failed photo is skipped: a listing missing one
 * of seventeen images is still worth publishing.
 */
final class ImageStager {

    private static final String TAG = "AICC";
    private static final int MAX_PHOTOS = 17; // Mobile.bg stops accepting here.

    static File directory(Context context) {
        File dir = new File(context.getCacheDir(), "photos");
        if (!dir.exists() && !dir.mkdirs()) {
            Log.w(TAG, "Не създадох папката за снимките.");
        }
        return dir;
    }

    static void clear(Context context) {
        File[] files = directory(context).listFiles();
        if (files == null) return;
        for (File file : files) {
            if (!file.delete()) Log.w(TAG, "Не изтрих " + file.getName());
        }
    }

    /**
     * Downloads the draft's selected photos and returns them in order. The
     * result is what the file chooser needs answered, so an empty array means
     * there is nothing to upload rather than that something failed.
     */
    static File[] download(Context context, JSONArray images) {
        File dir = directory(context);
        JSONArray selected = new JSONArray();
        for (int i = 0; i < images.length(); i++) {
            JSONObject image = images.optJSONObject(i);
            if (image == null || !image.optBoolean("is_selected", true)) continue;
            selected.put(image);
            if (selected.length() >= MAX_PHOTOS) break;
        }

        java.util.List<File> files = new java.util.ArrayList<>();
        for (int i = 0; i < selected.length(); i++) {
            String source = selected.optJSONObject(i).optString("source_url", null);
            if (source == null || source.isEmpty()) continue;
            try {
                files.add(fetch(dir, source, i + 1));
            } catch (Exception error) {
                Log.w(TAG, "Снимка " + (i + 1) + " не се свали: " + error.getMessage());
            }
        }
        return files.toArray(new File[0]);
    }

    private static File fetch(File dir, String source, int index) throws IOException {
        File target = new File(dir, String.format(java.util.Locale.US, "%02d.jpg", index));
        if (target.exists() && target.length() > 0) return target;

        HttpURLConnection connection = (HttpURLConnection) new URL(source).openConnection();
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 13)");
        int status = connection.getResponseCode();
        if (status >= 400) {
            connection.disconnect();
            throw new IOException("HTTP " + status);
        }

        try (InputStream in = connection.getInputStream();
             FileOutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[16384];
            int read;
            while ((read = in.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }

        if (target.length() == 0) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
            throw new IOException("Празен файл");
        }
        return target;
    }

    static String readAsset(Context context, String name) {
        try (InputStream in = context.getAssets().open(name)) {
            byte[] buffer = new byte[in.available()];
            //noinspection ResultOfMethodCallIgnored
            in.read(buffer);
            return new String(buffer, StandardCharsets.UTF_8);
        } catch (IOException error) {
            Log.w(TAG, "Не прочетох " + name + ": " + error.getMessage());
            return "";
        }
    }
}