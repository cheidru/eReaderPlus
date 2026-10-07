package com.ereaderplus.app;

import android.net.Uri;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/** Denies camera, microphone, geolocation and other permission requests coming from book pages. */
public class BookChromeClient extends BridgeWebChromeClient {

    public BookChromeClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
        if (BookWebViewClient.isBookHost(request.getOrigin().getHost())) {
            request.deny();
            return;
        }
        super.onPermissionRequest(request);
    }

    @Override
    public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
        if (BookWebViewClient.isBookHost(Uri.parse(origin).getHost())) {
            callback.invoke(origin, false, false);
            return;
        }
        super.onGeolocationPermissionsShowPrompt(origin, callback);
    }
}
