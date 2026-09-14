# Arpos Ofisiant — Android qabıq (Faza 2a)

Nazik Capacitor 6 APK. Native sifariş UI yoxdur: WebView kassanın LAN HTTPS ünvanını açır (`/orders.html?mode=waiter`).

iOS bu fazada yoxdur. Oflayn sifariş növbəsi yoxdur.

## Tələblər

- JDK 17
- Android Studio (Android SDK + platform tools)
- Node 18+ (bu qovluqda `npm i`)
- Telefon və kassa **eyni Wi‑Fi**
- Kassada «Şəbəkədə aç» → `https://KASSA-IP:3443`

## Quruluş

```
cd mobile-waiter
npm i
npm run validate
npx cap sync android
npx cap open android
```

USB debug: Android Studio → Run. APK: Build → Build APK(s) (debug keystore kifayətdir).

Release imza (Play / sideload istehsal): Android Studio **Generate Signed App Bundle / APK**. Öz `keystore` faylını Git-ə qoymayın. Play listing bu fazada yoxdur.

## Telefonda

1. APK quraşdırın.
2. İlk açılışda **Kassa ünvanı**: `https://192.168.x.x:3443` (IP Ayarlar → Şəbəkə).
3. **Yadda saxla + Aç** → ofisiant (`mode=waiter`).
4. PIN → masa → məhsul → Qəbul et.

Ünvanı dəyişmək: sistem Geri (bootstrap forma) və ya ünvanı yenidən yazmaq üçün tətbiq məlumatını silin. Formanı məcburi göstərmək: WebView `index.html?setup=1` (ünvan saxlanıbsa avtomatik açılır).

HTTP **qəbul olunmur**. Yalnız `https://`.

## Öz-imzalı LAN sertifikat

Kassa sertifikatı öz-imzalıdır. Android 7+ tətbiqlər istifadəçi CA-ya default etibar etmir; bu qabıq `network_security_config` ilə **user** sertifikatlarına icazə verir (`cleartextTrafficPermitted=false`).

1. Kassanın CA / sertifikatını telefona quraşdırın (Ayarlar → Şifrələmə və etimad → Quraşdır), **və ya**
2. Brauzerdə `https://KASSA-IP:3443` açın, xəbərdarlığı oxuyun; WebView Chrome-un «bir dəfə davam et» seçimini paylaşmır — user CA daha etibarlıdır.

`usesCleartextTraffic` sönülüdür. Debug üçün HTTP açılmır.

## İkon / rəng

İkonlar `www/icons` (192/512, eyni Arpos markası). Status / splash fon: `#221d17`.

## CI

Root `npm test` config/HTML yoxlayır. Agent-də Android SDK yoxdursa APK build **məcburi deyil**.

Kassanın Windows Setup.exe (`dist/ArposRestoran-Setup.exe`) bu qovluğu **daxil etmir** — APK ayrıca yığılır.

