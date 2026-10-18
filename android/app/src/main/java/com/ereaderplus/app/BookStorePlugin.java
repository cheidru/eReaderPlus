package com.ereaderplus.app;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.webkit.WebViewCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Native side of src/platform/capacitor.ts: book files live in filesDir/books/&lt;bookId&gt;/ and are served to the
 * WebView by {@link BookWebViewClient} from https://&lt;bookId&gt;.ereaderplus.invalid/.
 */
@CapacitorPlugin(
    name = "BookStore",
    // Folder browsing before Android 11; from Android 11 on it needs "All files access" (MANAGE_EXTERNAL_STORAGE).
    permissions = { @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "storage") }
)
public class BookStorePlugin extends Plugin {

    private static final Pattern BOOK_ID = Pattern.compile("^[a-f0-9]{32}$");
    private static final int MAX_ENTRIES = 50_000;
    private static final long MAX_TOTAL_BYTES = 4L * 1024 * 1024 * 1024;
    private static final String[] BOOK_MIME_TYPES = {
        "application/epub+zip",
        "application/x-fictionbook+xml",
        "application/x-fictionbook",
        "application/vnd.comicbook+zip",
        "application/x-cbz",
        "application/x-mobipocket-ebook",
        "application/vnd.amazon.ebook",
        "application/vnd.amazon.mobi8-ebook",
        "image/vnd.djvu",
        "image/x-djvu",
        "application/pdf",
        "application/vnd.ms-htmlhelp",
        "application/x-chm",
        "application/x-ms-reader",
        "text/markdown",
        "text/x-markdown",
        "text/plain",
        "application/zip",
        "application/octet-stream",
        "text/xml",
    };

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    /** Folder listing and scans, which can take a while, so they never hold up reading book files on {@link #io}. */
    private final ExecutorService folders = Executors.newSingleThreadExecutor();
    private final List<JSObject> pendingOpenFiles = new ArrayList<>();

    @Override
    public void load() {
        bridge.setWebViewClient(new BookWebViewClient(bridge));
        bridge.getWebView().setWebChromeClient(new BookChromeClient(bridge));
        Activity activity = getActivity();
        if (activity != null) queueOpenIntent(activity.getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        queueOpenIntent(intent, true);
    }

    private void queueOpenIntent(Intent intent, boolean notify) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getData() == null) return;
        Uri uri = intent.getData();
        JSObject file = fileRef(uri);
        if (notify && hasListeners("openFile")) {
            notifyListeners("openFile", file);
        } else {
            synchronized (pendingOpenFiles) {
                pendingOpenFiles.add(file);
            }
        }
    }

    private JSObject fileRef(Uri uri) {
        JSObject file = new JSObject();
        file.put("ref", uri.toString());
        file.put("name", displayName(uri));
        return file;
    }

    private String displayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (Exception ignored) {
            // Fall back to the last path segment below.
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "book";
    }

    @PluginMethod
    public void takePendingOpenFiles(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (pendingOpenFiles) {
            for (JSObject file : pendingOpenFiles) files.put(file);
            pendingOpenFiles.clear();
        }
        JSObject result = new JSObject();
        result.put("files", files);
        call.resolve(result);
    }

    @PluginMethod
    public void pickBookFile(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, BOOK_MIME_TYPES);
        startActivityForResult(call, intent, "onBookPicked");
    }

    @ActivityCallback
    private void onBookPicked(PluginCall call, ActivityResult result) {
        JSObject response = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null && data.getData() != null) {
            response.put("file", fileRef(data.getData()));
        } else {
            response.put("file", JSObject.NULL);
        }
        call.resolve(response);
    }

    @PluginMethod
    public void extractArchive(PluginCall call) {
        String uri = call.getString("uri");
        String bookId = call.getString("bookId");
        io.execute(() -> {
            try {
                List<String> paths;
                try {
                    paths = unzip(Uri.parse(uri), bookId, StandardCharsets.UTF_8);
                } catch (IllegalArgumentException malformedNames) {
                    // Old archives store names in the DOS code page rather than UTF-8.
                    deleteRecursively(bookDir(bookId));
                    paths = unzip(Uri.parse(uri), bookId, Charset.forName("IBM437"));
                }
                JSArray array = new JSArray();
                for (String path : paths) array.put(path);
                JSObject result = new JSObject();
                result.put("paths", array);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Could not extract the archive: " + e.getMessage(), e);
            }
        });
    }

    private List<String> unzip(Uri uri, String bookId, Charset charset) throws IOException {
        List<String> paths = new ArrayList<>();
        long total = 0;
        byte[] buffer = new byte[64 * 1024];
        try (InputStream raw = getContext().getContentResolver().openInputStream(uri); ZipInputStream zip = new ZipInputStream(raw, charset)) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                if (paths.size() >= MAX_ENTRIES) throw new IOException("Archive has too many files");
                String name = entry.getName().replace('\\', '/');
                File target = resolveInBook(bookId, name);
                File parent = target.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
                try (OutputStream out = new FileOutputStream(target)) {
                    int n;
                    while ((n = zip.read(buffer)) > 0) {
                        total += n;
                        if (total > MAX_TOTAL_BYTES) throw new IOException("Archive is too large");
                        out.write(buffer, 0, n);
                    }
                }
                paths.add(name);
            }
        }
        return paths;
    }

    @PluginMethod
    public void copyRawFile(PluginCall call) {
        String uri = call.getString("uri");
        String bookId = call.getString("bookId");
        String path = call.getString("path");
        io.execute(() -> {
            try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri))) {
                if (in == null) throw new IOException("Cannot open the file");
                writeFile(resolveInBook(bookId, path), in);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not copy the file: " + e.getMessage(), e);
            }
        });
    }

    // Book files are read by the WebView from BookWebViewClient.APP_BOOK_PREFIX, streamed from disk.

    @PluginMethod
    public void writeText(PluginCall call) {
        io.execute(() -> {
            try {
                byte[] data = call.getString("text", "").getBytes(StandardCharsets.UTF_8);
                writeBytes(resolveInBook(call.getString("bookId"), call.getString("path")), data);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void writeBinary(PluginCall call) {
        io.execute(() -> {
            try {
                byte[] data = Base64.decode(call.getString("base64", ""), Base64.DEFAULT);
                writeBytes(resolveInBook(call.getString("bookId"), call.getString("path")), data);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void deleteBook(PluginCall call) {
        io.execute(() -> {
            try {
                deleteRecursively(bookDir(call.getString("bookId")));
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (scheme == null || !(scheme.equals("http") || scheme.equals("https") || scheme.equals("mailto"))) {
            call.reject("Refusing to open a non-web URL");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No app can open this link", e);
        }
    }

    @PluginMethod
    public void webViewInfo(PluginCall call) {
        JSObject result = new JSObject();
        PackageInfo info = WebViewCompat.getCurrentWebViewPackage(getContext());
        result.put("packageName", info != null ? info.packageName : "");
        result.put("versionName", info != null ? info.versionName : "");
        result.put("androidVersion", Build.VERSION.RELEASE);
        call.resolve(result);
    }

    // --- Folders: the in-app folder browser and watched-folder scans ------------------------------

    /** Deeper than this is almost certainly not a book collection (and guards against pathological trees). */
    private static final int MAX_SCAN_DEPTH = 16;
    /** A scan stops after this many book files. */
    private static final int MAX_SCAN_FILES = 20_000;

    /**
     * Browsing folders needs "All files access" on Android 11+ (granted in system settings) and the storage
     * permission before that.
     */
    private boolean folderAccessGranted() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        return getPermissionState("storage") == PermissionState.GRANTED;
    }

    private void resolveFolderAccess(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", folderAccessGranted());
        call.resolve(result);
    }

    @PluginMethod
    public void hasFolderAccess(PluginCall call) {
        resolveFolderAccess(call);
    }

    @PluginMethod
    public void requestFolderAccess(PluginCall call) {
        if (folderAccessGranted()) {
            resolveFolderAccess(call);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
            try {
                startActivityForResult(call, intent, "onFolderAccessResult");
            } catch (ActivityNotFoundException e) {
                // Some devices only have the general list of apps with all files access.
                startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION), "onFolderAccessResult");
            }
        } else {
            requestPermissionForAlias("storage", call, "onStoragePermissionResult");
        }
    }

    @ActivityCallback
    private void onFolderAccessResult(PluginCall call, ActivityResult result) {
        resolveFolderAccess(call);
    }

    @PermissionCallback
    private void onStoragePermissionResult(PluginCall call) {
        resolveFolderAccess(call);
    }

    /** Internal storage, then removable volumes (SD cards, USB drives), found through the app's folder on each. */
    private List<File> storageRoots() {
        List<File> roots = new ArrayList<>();
        roots.add(Environment.getExternalStorageDirectory());
        for (File appDir : getContext().getExternalFilesDirs(null)) {
            if (appDir == null) continue;
            String path = appDir.getAbsolutePath();
            int at = path.indexOf("/Android/data/");
            if (at <= 0) continue;
            File root = new File(path.substring(0, at));
            if (!roots.contains(root)) roots.add(root);
        }
        return roots;
    }

    private static boolean isHidden(String name) {
        return name.startsWith(".") || name.equalsIgnoreCase("LOST.DIR");
    }

    private static boolean hasExtension(String name, Set<String> extensions) {
        int dot = name.lastIndexOf('.');
        return dot > 0 && extensions.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT));
    }

    private static Set<String> extensionSet(PluginCall call) {
        Set<String> extensions = new HashSet<>();
        JSArray array = call.getArray("extensions");
        if (array == null) return extensions;
        for (int i = 0; i < array.length(); i++) {
            String ext = array.optString(i, "");
            if (!ext.isEmpty()) extensions.add(ext.toLowerCase(Locale.ROOT));
        }
        return extensions;
    }

    private static JSObject folderEntry(String name, File dir) {
        JSObject entry = new JSObject();
        entry.put("name", name);
        entry.put("path", dir.getAbsolutePath());
        return entry;
    }

    @PluginMethod
    public void listFolder(PluginCall call) {
        String path = call.getString("path", "");
        Set<String> extensions = extensionSet(call);
        folders.execute(() -> {
            JSObject result = new JSObject();
            JSArray list = new JSArray();
            JSArray books = new JSArray();
            String error = null;
            List<File> roots = storageRoots();
            if (path == null || path.isEmpty()) {
                for (int i = 0; i < roots.size(); i++) {
                    File root = roots.get(i);
                    list.put(folderEntry(i == 0 ? "Internal storage" : "SD card (" + root.getName() + ")", root));
                }
                result.put("path", "");
                result.put("parent", JSObject.NULL);
            } else {
                File dir = new File(path);
                File[] children = dir.listFiles();
                if (children == null) {
                    error = folderAccessGranted() ? "This folder can't be read." : "The app has no access to the device's folders.";
                } else {
                    List<File> subfolders = new ArrayList<>();
                    List<File> bookFiles = new ArrayList<>();
                    for (File child : children) {
                        if (child.isDirectory() && !isHidden(child.getName())) subfolders.add(child);
                        else if (child.isFile() && hasExtension(child.getName(), extensions)) bookFiles.add(child);
                    }
                    Collections.sort(subfolders, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                    Collections.sort(bookFiles, (a, b) -> a.getName().compareToIgnoreCase(b.getName()));
                    for (File folder : subfolders) list.put(folderEntry(folder.getName(), folder));
                    for (File book : bookFiles) books.put(bookFileEntry(book));
                }
                result.put("path", dir.getAbsolutePath());
                // The parent of a storage root is the roots list.
                result.put("parent", roots.contains(dir) || dir.getParent() == null ? "" : dir.getParent());
            }
            result.put("folders", list);
            result.put("books", books);
            result.put("error", error == null ? JSObject.NULL : error);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void findBookFiles(PluginCall call) {
        String folder = call.getString("folder", "");
        Set<String> extensions = extensionSet(call);
        folders.execute(() -> {
            JSArray files = new JSArray();
            walk(new File(folder), extensions, 0, new HashSet<>(), files);
            JSObject result = new JSObject();
            result.put("files", files);
            call.resolve(result);
        });
    }

    /** A book file as src/platform/platform.ts FoundBookFile: a file:// reference the importer can open, size and date. */
    private static JSObject bookFileEntry(File file) {
        JSObject fileRef = new JSObject();
        fileRef.put("ref", Uri.fromFile(file).toString());
        fileRef.put("name", file.getName());
        JSObject entry = new JSObject();
        entry.put("file", fileRef);
        entry.put("path", file.getAbsolutePath());
        entry.put("size", file.length());
        entry.put("modified", file.lastModified());
        return entry;
    }

    /** `visited` holds canonical paths, so a folder reached again through a link is not walked twice. */
    private static void walk(File dir, Set<String> extensions, int depth, Set<String> visited, JSArray found) {
        if (depth > MAX_SCAN_DEPTH || found.length() >= MAX_SCAN_FILES) return;
        try {
            if (!visited.add(dir.getCanonicalPath())) return;
        } catch (IOException e) {
            return;
        }
        File[] children = dir.listFiles();
        if (children == null) return; // Unreadable: skipped, the rest of the collection still counts.
        for (File child : children) {
            if (found.length() >= MAX_SCAN_FILES) return;
            if (child.isDirectory()) {
                if (!isHidden(child.getName())) walk(child, extensions, depth + 1, visited, found);
            } else if (child.isFile() && hasExtension(child.getName(), extensions)) {
                found.put(bookFileEntry(child));
            }
        }
    }

    // --- Files ------------------------------------------------------------------------------------

    static File booksRoot(Context context) {
        return new File(context.getFilesDir(), "books");
    }

    static boolean isBookId(String bookId) {
        return bookId != null && BOOK_ID.matcher(bookId).matches();
    }

    private File bookDir(String bookId) throws IOException {
        if (!isBookId(bookId)) throw new IOException("Invalid book id");
        return new File(booksRoot(getContext()), bookId);
    }

    /** Resolves a book-relative path, refusing anything that escapes the book folder. */
    static File resolveInBook(Context context, String bookId, String relative) throws IOException {
        if (!isBookId(bookId) || relative == null) throw new IOException("Invalid path");
        File dir = new File(booksRoot(context), bookId).getCanonicalFile();
        File file = new File(dir, relative.replaceFirst("^/+", "")).getCanonicalFile();
        if (!file.getPath().startsWith(dir.getPath() + File.separator)) throw new IOException("Path escapes the book folder: " + relative);
        return file;
    }

    private File resolveInBook(String bookId, String relative) throws IOException {
        return resolveInBook(getContext(), bookId, relative);
    }

    private static void writeFile(File target, InputStream in) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
        try (OutputStream out = new FileOutputStream(target)) {
            byte[] buffer = new byte[64 * 1024];
            int n;
            while ((n = in.read(buffer)) > 0) out.write(buffer, 0, n);
        }
    }

    private static void writeBytes(File target, byte[] data) throws IOException {
        File parent = target.getParentFile();
        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
        try (OutputStream out = new FileOutputStream(target)) {
            out.write(data);
        }
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
