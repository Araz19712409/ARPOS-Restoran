package az.arpos.waiter;

import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.webkit.SslErrorHandler;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
      @Override
      public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        String host = hostFromSsl(error);
        if (isPrivateLanHost(host)) {
          handler.proceed();
        } else {
          handler.cancel();
        }
      }
    });
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
        if (webView != null && webView.canGoBack()) {
          webView.goBack();
        } else {
          setEnabled(false);
          getOnBackPressedDispatcher().onBackPressed();
        }
      }
    });
  }

  static String hostFromSsl(SslError error) {
    if (error == null) {
      return "";
    }
    try {
      String url = error.getUrl();
      if (url == null || url.isEmpty()) {
        return "";
      }
      String host = Uri.parse(url).getHost();
      return host == null ? "" : host;
    } catch (Exception e) {
      return "";
    }
  }

  static boolean isPrivateLanHost(String host) {
    if (host == null || host.isEmpty()) {
      return false;
    }
    host = host.toLowerCase(Locale.US);
    if (host.startsWith("[") && host.endsWith("]")) {
      host = host.substring(1, host.length() - 1);
    }
    if (host.equals("localhost") || host.equals("127.0.0.1") || host.equals("::1")) {
      return true;
    }
    String[] p = host.split("\\.");
    if (p.length != 4) {
      return false;
    }
    try {
      int a = Integer.parseInt(p[0]);
      int b = Integer.parseInt(p[1]);
      int c = Integer.parseInt(p[2]);
      int d = Integer.parseInt(p[3]);
      if (a < 0 || a > 255 || b < 0 || b > 255 || c < 0 || c > 255 || d < 0 || d > 255) {
        return false;
      }
      if (a == 10 || a == 127) {
        return true;
      }
      if (a == 192 && b == 168) {
        return true;
      }
      return a == 172 && b >= 16 && b <= 31;
    } catch (NumberFormatException e) {
      return false;
    }
  }
}
