package com.ereaderplus.app;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves each book from its own origin, https://&lt;bookId&gt;.ereaderplus.invalid/, so book scripts are
 * cross-origin to the app (https://localhost) and isolated from other books. Mirrors electron/protocols.ts.
 */
public class BookWebViewClient extends BridgeWebViewClient {

    static final String BOOK_HOST_SUFFIX = ".ereaderplus.invalid";
    private static final String READER_ASSETS_PREFIX = "/__ereader__/";
    private static final String BOOK_CSP =
        "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval'; " +
        "connect-src 'self' data: blob:; form-action 'none'; base-uri 'self'; frame-ancestors https://localhost";

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("htm", "text/html");
        MIME.put("xhtml", "application/xhtml+xml");
        MIME.put("xht", "application/xhtml+xml");
        MIME.put("xml", "application/xml");
        MIME.put("opf", "application/oebps-package+xml");
        MIME.put("ncx", "application/x-dtbncx+xml");
        MIME.put("css", "text/css");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("webp", "image/webp");
        MIME.put("avif", "image/avif");
        MIME.put("bmp", "image/bmp");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("mp3", "audio/mpeg");
        MIME.put("m4a", "audio/mp4");
        MIME.put("ogg", "audio/ogg");
        MIME.put("opus", "audio/ogg");
        MIME.put("wav", "audio/wav");
        MIME.put("mp4", "video/mp4");
        MIME.put("m4v", "video/mp4");
        MIME.put("webm", "video/webm");
        MIME.put("vtt", "text/vtt");
        MIME.put("smil", "application/smil+xml");
        MIME.put("wasm", "application/wasm");
        MIME.put("txt", "text/plain");
    }

    private final Context context;

    public BookWebViewClient(Bridge bridge) {
        super(bridge);
        this.context = bridge.getContext();
    }

    static boolean isBookHost(String host) {
        return host != null && host.endsWith(BOOK_HOST_SUFFIX);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (isBookHost(url.getHost())) return serveBook(url);
        // Defense in depth: book CSP already blocks the network; also refuse anything a book page asks for.
        String referer = request.getRequestHeaders().get("Referer");
        if (referer != null && isBookHost(Uri.parse(referer).getHost())) return status(403, "Forbidden");
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        if (isBookHost(request.getUrl().getHost())) {
            // Books load only inside the reader iframe, never as the top-level page.
            return request.isForMainFrame();
        }
        return super.shouldOverrideUrlLoading(view, request);
    }

    private WebResourceResponse serveBook(Uri url) {
        String host = url.getHost();
        String bookId = host.substring(0, host.length() - BOOK_HOST_SUFFIX.length());
        String path = url.getPath() == null ? "/" : url.getPath();
        try {
            InputStream body;
            if (path.startsWith(READER_ASSETS_PREFIX)) {
                String asset = path.substring(READER_ASSETS_PREFIX.length());
                if (asset.contains("..")) return status(404, "Not Found");
                body = context.getAssets().open("public/__ereader__/" + asset);
            } else {
                File file = BookStorePlugin.resolveInBook(context, bookId, path);
                if (!file.isFile()) return status(404, "Not Found");
                body = new FileInputStream(file);
            }
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", BOOK_CSP);
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Cache-Control", "no-cache");
            String mime = mimeType(path);
            String encoding = mime.startsWith("text/") || mime.contains("xml") || mime.endsWith("json") ? "utf-8" : null;
            return new WebResourceResponse(mime, encoding, 200, "OK", headers, body);
        } catch (IOException e) {
            return status(404, "Not Found");
        }
    }

    private static String mimeType(String path) {
        int dot = path.lastIndexOf('.');
        String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String mime = MIME.get(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
}
