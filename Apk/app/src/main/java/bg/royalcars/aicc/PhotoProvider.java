package bg.royalcars.aicc;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Serves the staged photos to the WebView's file chooser.
 *
 * Android's FileProvider would do this, but it lives in androidx.core and would
 * pull a dependency into an app that otherwise has none. This provider does the
 * one thing that is actually needed: open a file from the app's own photo
 * directory as a read-only descriptor.
 *
 * The path is confined to that directory. A caller cannot ask for any other
 * file, and the descriptor is granted per-URI by the chooser, so the browser
 * never gets access to the app's storage in general.
 */
public final class PhotoProvider extends ContentProvider {

    static final String AUTHORITY_SUFFIX = ".files";

    @Override
    public boolean onCreate() {
        return true;
    }

    private File resolve(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null || name.contains("/") || name.contains("..")) {
            return null;
        }
        return new File(getContext().getCacheDir(), "photos/" + name);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws java.io.FileNotFoundException {
        File file = resolve(uri);
        if (file == null || !file.exists()) {
            throw new java.io.FileNotFoundException("Няма такава снимка: " + uri);
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Само за четене.");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Само за четене.");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        throw new UnsupportedOperationException("Само за четене.");
    }
}