package bg.royalcars.aicc;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * The only network client in the app.
 *
 * Supabase is reached over its REST API with plain HttpURLConnection rather than
 * a client library: the app needs four calls, and a library would add a large
 * dependency and a second session store for no benefit. The session token is
 * kept in SharedPreferences so the operator signs in once.
 */
final class SupabaseClient {

    private static final String TAG = "AICC";
    private static final String PREFS = "aicc";
    private static final String KEY_URL = "supabase_url";
    private static final String KEY_ANON = "supabase_anon";
    private static final String KEY_TOKEN = "access_token";
    private static final String KEY_REFRESH = "refresh_token";
    private static final String KEY_EMAIL = "email";

    // Public project values. The anon key is a publishable key and is already
    // shipped inside the web bundle, so it is not a secret. No service-role key
    // is ever used here.
    static final String DEFAULT_URL = "https://cgftjqwebvddtsbcbeml.supabase.co";
    static final String DEFAULT_ANON =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnZnRqcXdl"
            + "YnZkZHRzYmNiZW1sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTkyMDMsImV4cCI6MjEwNDg5NTIw"
            + "M30.JjW374ZSLxoSWQ7786aZlCbNyk9u2gKRdlb-dED-m0A";
    static final String ADMIN_EMAIL = "tasevrosen86@gmail.com";

    private final SharedPreferences prefs;

    SupabaseClient(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!prefs.contains(KEY_URL)) {
            prefs.edit().putString(KEY_URL, DEFAULT_URL).putString(KEY_ANON, DEFAULT_ANON).apply();
        }
    }

    private String url() {
        return prefs.getString(KEY_URL, DEFAULT_URL);
    }

    private String anon() {
        return prefs.getString(KEY_ANON, DEFAULT_ANON);
    }

    String token() {
        return prefs.getString(KEY_TOKEN, null);
    }

    String email() {
        return prefs.getString(KEY_EMAIL, ADMIN_EMAIL);
    }

    boolean hasSession() {
        return token() != null;
    }

    void signOut() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_REFRESH).apply();
    }

    /**
     * Signs in with the password the operator types. The email is fixed because
     * this is a single-account internal tool, which is also what the web app
     * does; it means the phone screen needs one field instead of two.
     */
    JSONObject signIn(String password) throws Exception {
        String body = new JSONObject()
                .put("email", ADMIN_EMAIL)
                .put("password", password)
                .toString();
        JSONObject result = request("POST", "/auth/v1/token?grant_type=password", body, false);

        String access = result.optString("access_token", null);
        String refresh = result.optString("refresh_token", null);
        if (access == null || access.isEmpty()) {
            return result;
        }
        prefs.edit()
                .putString(KEY_TOKEN, access)
                .putString(KEY_REFRESH, refresh)
                .putString(KEY_EMAIL, result.optJSONObject("user") != null
                        ? result.optJSONObject("user").optString("email", ADMIN_EMAIL)
                        : ADMIN_EMAIL)
                .apply();
        return result;
    }

    /**
     * The drafts that are ready to publish, newest first. Only the columns the
     * list needs are requested, so the answer stays small on a phone connection.
     */
    JSONArray listDrafts() throws Exception {
        return requestArray("GET",
                "/rest/v1/mobile_bg_drafts?select=id,title,status,created_at,extraction_status"
                + "&order=created_at.desc&limit=60", null);
    }

    /** The scattered field rows of one draft, which the plan builder consumes. */
    JSONArray draftFields(String draftId) throws Exception {
        return requestArray("GET",
                "/rest/v1/mobile_bg_draft_fields?select=field_key,value,source"
                + "&draft_id=eq." + draftId + "&order=field_key", null);
    }

    /**
     * Queues a source listing link for extraction and returns the draft it made.
     *
     * The fetching is not done here. It runs on the server, where a real browser
     * reaches Encar and AutoTrader — this is the separate URL importer, and it has
     * nothing to do with the Mobile.bg form on the phone. The edge function needs
     * the signed-in user, not the anon key, so this call is authenticated.
     */
    JSONObject queueSourceIntake(String sourceUrl) throws Exception {
        JSONObject body = new JSONObject()
                .put("source_url", sourceUrl)
                .put("intake_origin", "LINK_FIELD");
        return request("POST", "/functions/v1/queue-source-intake", body.toString(), true);
    }

    JSONArray draftExtras(String draftId) throws Exception {
        return requestArray("GET",
                "/rest/v1/mobile_bg_draft_extras?select=extra_key,mobile_bg_label,selected"
                + "&draft_id=eq." + draftId, null);
    }

    JSONArray draftImages(String draftId) throws Exception {
        return requestArray("GET",
                "/rest/v1/mobile_bg_draft_images?select=source_url,is_selected,display_order"
                + "&draft_id=eq." + draftId + "&order=display_order", null);
    }

    /**
     * Writes the Mobile.bg URL back onto the draft. This is the only write the
     * app performs, and it is the record that a listing really exists: the URL
     * is read off the public page after publishing, never assumed.
     */
    void recordPublished(String draftId, String publicUrl) throws Exception {
        JSONObject patch = new JSONObject().put("mobile_bg_url", publicUrl);
        request("PATCH", "/rest/v1/mobile_bg_drafts?id=eq." + draftId, patch.toString(), true);
    }

    private JSONObject request(String method, String path, String body, boolean authenticated) throws Exception {
        HttpURLConnection connection = open(method, path, authenticated);
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = connection.getResponseCode();
        String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream());
        connection.disconnect();
        if (text == null || text.trim().isEmpty()) {
            text = "{}";
        }
        JSONObject parsed = new JSONObject(text.trim().startsWith("[") ? "{\"items\":" + text + "}" : text);
        if (status >= 400) {
            String message = parsed.optString("msg", null);
            if (message == null) message = parsed.optString("message", null);
            if (message == null) message = parsed.optString("error_description", null);
            if (message == null) message = "HTTP " + status;
            throw new Exception(message);
        }
        return parsed;
    }

    private JSONArray requestArray(String method, String path, String body) throws Exception {
        JSONObject wrapped = request(method, path, body, true);
        if (wrapped.has("items")) {
            return wrapped.getJSONArray("items");
        }
        return new JSONArray().put(wrapped);
    }

    private HttpURLConnection open(String method, String path, boolean authenticated) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url() + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(20000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("apikey", anon());
        connection.setRequestProperty("Authorization", "Bearer " + (authenticated ? token() : anon()));
        connection.setRequestProperty("Accept", "application/json");
        // Returning the row after a PATCH makes the write verifiable instead of
        // fire-and-forget.
        connection.setRequestProperty("Prefer", "return=representation");
        return connection;
    }

    private static String read(InputStream stream) {
        if (stream == null) {
            return null;
        }
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line);
            }
            return builder.toString();
        } catch (Exception error) {
            Log.w(TAG, "Не прочетох отговора: " + error.getMessage());
            return null;
        }
    }
}