package bg.royalcars.aicc;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The whole phone app: sign in, pick a draft, and drive Mobile.bg's own form.
 *
 * There is no automation service behind this. The WebView opens the real
 * Mobile.bg page and the operator is looking at it the whole time, so the app
 * never has to defeat a bot check and the account stays a normal account. The
 * app fills the fields from the proven mapping and then stops: uploading the
 * photos and pressing «ПРОДЪЛЖИ» stay in the operator's hands, because the
 * listing carries their phone number and their reputation.
 *
 * The screens are built in code rather than XML. There are three of them and
 * they are trivial; keeping them here means the whole flow is readable in one
 * file and no resource lookup can fail at runtime.
 */
public class MainActivity extends Activity {

    private static final String TAG = "AICC";
    private static final String MOBILE_BG_PUBLISH =
            "https://www.mobile.bg/pcgi/mobile.cgi?pubtype=1&act=6&subact=4&actions=1";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private SupabaseClient supabase;
    private FrameLayout root;
    private WebView webView;
    private TextView status;

    private String activeDraftId;
    private String activeDraftTitle;
    private File[] stagedPhotos = new File[0];
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        supabase = new SupabaseClient(this);
        root = new FrameLayout(this);
        setContentView(root);
        if (supabase.hasSession()) {
            showDraftList();
        } else {
            showLogin();
        }
    }

    // ---------------------------------------------------------------- screens

    private void showLogin() {
        LinearLayout column = column();
        column.addView(heading("AICC Mobile"));
        column.addView(note("Влизане с акаунта на приложението."));

        EditText password = new EditText(this);
        password.setHint("Парола");
        password.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        column.addView(password);

        Button submit = button("Влез");
        TextView message = note("");
        submit.setOnClickListener(view -> {
            String value = password.getText().toString();
            if (value.length() < 10) {
                message.setText("Паролата е поне 10 символа.");
                return;
            }
            submit.setEnabled(false);
            message.setText("Влизам…");
            worker.execute(() -> {
                try {
                    supabase.signIn(value);
                    runOnUiThread(this::showDraftList);
                } catch (Exception error) {
                    runOnUiThread(() -> {
                        message.setText("Не влязох: " + error.getMessage());
                        submit.setEnabled(true);
                    });
                }
            });
        });

        column.addView(submit);
        column.addView(message);
        setScreen(scroll(column));
    }

    private void showDraftList() {
        LinearLayout column = column();
        column.addView(heading("Чернови"));
        TextView message = note("Зареждам…");
        column.addView(message);

        Button refresh = button("Презареди");
        refresh.setOnClickListener(view -> showDraftList());
        column.addView(refresh);

        Button out = button("Изход");
        out.setOnClickListener(view -> {
            supabase.signOut();
            showLogin();
        });
        column.addView(out);

        setScreen(scroll(column));

        worker.execute(() -> {
            try {
                JSONArray drafts = supabase.listDrafts();
                runOnUiThread(() -> {
                    column.removeView(message);
                    if (drafts.length() == 0) {
                        column.addView(note("Няма чернови."));
                        return;
                    }
                    for (int i = 0; i < drafts.length(); i++) {
                        JSONObject draft = drafts.optJSONObject(i);
                        if (draft == null) continue;
                        column.addView(draftRow(draft));
                    }
                });
            } catch (Exception error) {
                runOnUiThread(() -> message.setText("Не заредих: " + error.getMessage()));
            }
        });
    }

    private View draftRow(JSONObject draft) {
        String id = draft.optString("id");
        String title = draft.optString("title", "Без заглавие");
        String state = draft.optString("extraction_status", draft.optString("status", ""));

        LinearLayout card = column();
        card.setPadding(28, 28, 28, 28);
        card.setBackgroundColor(Color.WHITE);

        TextView name = new TextView(this);
        name.setText(title);
        name.setTextSize(16f);
        name.setTextColor(Color.parseColor("#0f172a"));
        card.addView(name);

        TextView meta = note(id.substring(0, 8) + " · " + state);
        card.addView(meta);

        Button open = button("Публикувай в Mobile.bg");
        open.setOnClickListener(view -> openPublisher(id, title));
        card.addView(open);

        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, 24);
        card.setLayoutParams(params);
        return card;
    }

    /**
     * Opens the real Mobile.bg publish form. Nothing is filled yet: the plan is
     * built only once the page has loaded, so a slow form never receives a fill
     * against a half-rendered document.
     */
    private void openPublisher(String draftId, String title) {
        activeDraftId = draftId;
        activeDraftTitle = title;
        stagedPhotos = new File[0];

        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);

        TextView bar = note("Отварям формата на Mobile.bg…");

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setPadding(16, 12, 16, 12);

        Button fill = button("Попълни");
        fill.setOnClickListener(view -> requestFill());
        controls.addView(fill);

        Button photos = button("Снимки");
        photos.setOnClickListener(view -> stagePhotos());
        controls.addView(photos);

        Button save = button("Запиши адреса");
        save.setOnClickListener(view -> recordPublishedUrl());
        controls.addView(save);

        Button back = button("Назад");
        back.setOnClickListener(view -> showDraftList());
        controls.addView(back);

        column.addView(controls);
        column.addView(bar);

        // The WebView is attached before setScreen clears the fields, because
        // setScreen is what would otherwise wipe the two references this screen
        // depends on. Nothing is loaded until both are back in place.
        WebView browser = buildWebView();
        column.addView(browser, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        setScreen(column);
        webView = browser;
        status = bar;
        webView.loadUrl(MOBILE_BG_PUBLISH);
    }

    // ------------------------------------------------------------ mobile.bg

    private WebView buildWebView() {
        WebView view = new WebView(this);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setUserAgentString(
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36");

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(view, true);

        view.addJavascriptInterface(new Bridge(), "AICCBridge");

        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView target, WebResourceRequest request) {
                return false; // Every link stays in the app; this is the point.
            }

            @Override
            public void onPageFinished(WebView target, String url) {
                injectLibrary(target);
            }
        });

        view.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView target, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                return answerFileChooser(callback);
            }
        });

        return view;
    }

    /**
     * Puts the mapping and the fill routine into the page once it has loaded.
     *
     * The library is evaluated as a plain expression rather than wrapped in
     * eval() or a javascript: URL: Mobile.bg serves a Content-Security-Policy
     * that forbids eval, and a javascript: string is not run by
     * evaluateJavascript at all. A bare evaluation is what both of them allow.
     */
    private void injectLibrary(WebView target) {
        String library = ImageStager.readAsset(this, "combined.js");
        if (library.isEmpty()) {
            status.setText("Липсва вграденият скрипт. Престрои приложението.");
            return;
        }
        target.evaluateJavascript(library, null);
        status.setText("Формата е заредена. Натисни «Попълни».");
    }

    /**
     * Answers Mobile.bg's photo field with the photos staged for this draft.
     *
     * The chooser cannot be opened by script, so this runs when the operator
     * taps the photo field. If no photos were staged the chooser is cancelled
     * rather than sending the user to the system picker: the operator has
     * already chosen the photos in the web app.
     */
    private boolean answerFileChooser(ValueCallback<Uri[]> callback) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
        }
        fileCallback = callback;

        if (stagedPhotos.length == 0) {
            status.setText("Няма подготвени снимки. Натисни «Снимки» първо.");
            callback.onReceiveValue(null);
            fileCallback = null;
            return true;
        }

        Uri[] uris = new Uri[stagedPhotos.length];
        for (int i = 0; i < stagedPhotos.length; i++) {
            uris[i] = Uri.parse("content://" + getPackageName() + PhotoProvider.AUTHORITY_SUFFIX
                    + "/" + stagedPhotos[i].getName());
        }
        callback.onReceiveValue(uris);
        fileCallback = null;
        status.setText("Предадох " + uris.length + " снимки на Mobile.bg.");
        return true;
    }

    private void stagePhotos() {
        if (activeDraftId == null) return;
        status.setText("Свалям снимките…");
        String draftId = activeDraftId;
        worker.execute(() -> {
            try {
                JSONArray images = supabase.draftImages(draftId);
                ImageStager.clear(this);
                File[] files = ImageStager.download(this, images);
                stagedPhotos = files;
                runOnUiThread(() -> status.setText(files.length == 0
                        ? "Няма снимки в черновата."
                        : "Готови " + files.length + " снимки. Натисни полето за снимки във формата."));
            } catch (Exception error) {
                runOnUiThread(() -> status.setText("Снимките не се свалиха: " + error.getMessage()));
            }
        });
    }

    /** Pulls the draft, builds the plan in the page, and fills the form. */
    private void requestFill() {
        if (activeDraftId == null || webView == null) return;
        status.setText("Сглобявам плана…");
        String draftId = activeDraftId;
        worker.execute(() -> {
            try {
                JSONArray fields = supabase.draftFields(draftId);
                JSONArray extras = supabase.draftExtras(draftId);
                runOnUiThread(() -> injectAndFill(fields, extras));
            } catch (Exception error) {
                runOnUiThread(() -> status.setText("Планът не се сглоби: " + error.getMessage()));
            }
        });
    }

    private void injectAndFill(JSONArray fields, JSONArray extras) {
        String fieldsJson = fields.toString();
        String extrasJson = extras.toString();

        // The library is already in the page from onPageFinished. This call only
        // builds the plan from the live draft and starts the fill. The guard
        // turns a missing library into a readable message instead of a silent
        // "AICC is not defined" in the console.
        String script = "(function(){"
                + "if(typeof AICC==='undefined'||typeof fillMobileBgForm!=='function'){"
                + "AICCBridge.log('Библиотеката не е в страницата.');return;}"
                + "var plan=AICC.buildPlan(" + fieldsJson + "," + extrasJson + ");"
                + "fillMobileBgForm(plan.steps,plan.extras).then(function(r){"
                + "AICCBridge.filled(JSON.stringify({filled:r.filled.length,steps:plan.steps.length,"
                + "skipped:r.skipped.slice(0,6),missing:plan.missing}));"
                + "});"
                + "})()";

        status.setText("Попълвам…");
        webView.evaluateJavascript(script, null);
    }

    /**
     * Reads the address the browser ended up on and writes it onto the draft.
     * The URL is taken from the page, never typed in, so the stored link always
     * points at a listing that actually exists.
     */
    private void recordPublishedUrl() {
        if (webView == null || activeDraftId == null) return;
        String url = webView.getUrl();
        if (url == null || !url.contains("mobile.bg")) {
            status.setText("Още не сме на обява в Mobile.bg.");
            return;
        }
        String draftId = activeDraftId;
        status.setText("Записвам адреса…");
        worker.execute(() -> {
            try {
                supabase.recordPublished(draftId, url);
                runOnUiThread(() -> status.setText("Записах: " + url));
            } catch (Exception error) {
                runOnUiThread(() -> status.setText("Не записах: " + error.getMessage()));
            }
        });
    }

    /** Receives the fill report from the page. */
    private final class Bridge {
        @JavascriptInterface
        public void filled(String report) {
            runOnUiThread(() -> {
                try {
                    JSONObject result = new JSONObject(report);
                    int filled = result.optInt("filled");
                    int steps = result.optInt("steps");
                    JSONArray skipped = result.optJSONArray("skipped");
                    JSONArray missing = result.optJSONArray("missing");

                    StringBuilder text = new StringBuilder();
                    text.append("Попълнени ").append(filled).append(" от ").append(steps).append('.');
                    if (missing != null && missing.length() > 0) {
                        text.append("\nЛипсват: ").append(missing.join(", "));
                    }
                    if (skipped != null && skipped.length() > 0) {
                        text.append("\nПропуснати: ").append(skipped.length()).append(" (виж панела в страницата)");
                    }
                    text.append("\nПровери стойностите и натисни «ПРОДЪЛЖИ» сам.");
                    status.setText(text.toString());
                } catch (Exception error) {
                    status.setText("Отчет: " + report);
                }
            });
        }

        @JavascriptInterface
        public void log(String message) {
            Log.i(TAG, message);
        }
    }

    // ------------------------------------------------------------- plumbing

    @Override
    public void onBackPressed() {
        // Back returns to the draft list instead of leaving the app, so a
        // half-filled listing is never lost by a stray swipe.
        if (webView != null) {
            showDraftList();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (fileCallback != null) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onDestroy() {
        worker.shutdownNow();
        super.onDestroy();
    }

    /**
     * Swaps the whole screen. The WebView field is cleared here rather than by
     * the caller so a stale reference to a discarded WebView can never be filled
     * into; openPublisher re-assigns it after this returns.
     */
    private void setScreen(View view) {
        root.removeAllViews();
        webView = null;
        status = null;
        root.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private LinearLayout column() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(Color.parseColor("#f1f5f9"));
        return box;
    }

    private ScrollView scroll(LinearLayout content) {
        content.setPadding(32, 48, 32, 48);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(Color.parseColor("#f1f5f9"));
        scroll.addView(content);
        return scroll;
    }

    private TextView heading(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(24f);
        view.setTextColor(Color.parseColor("#0f172a"));
        view.setPadding(0, 0, 0, 16);
        return view;
    }

    private TextView note(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(13f);
        view.setTextColor(Color.parseColor("#475569"));
        view.setPadding(16, 8, 16, 8);
        return view;
    }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setAllCaps(false);
        button.setGravity(Gravity.CENTER);
        return button;
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show();
    }
}