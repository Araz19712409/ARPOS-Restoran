# Professional kassa — ardıcıllıq

Bir server: `3004`. Hər addım: əvvəl plan, sonra təsdiq, sonra kod.

## Boşluqlar (analiz 7.09.2026) — ardıcıl

### Təcili
1. [x] Kataloq zibilliyi: Çay reseptində ət, maya 4400; Ribay Bar-a gedir; çay/kofe qəlyanaltıda
2. [x] Soğan alış 20 AZN/kq (cəm kimi yazılıb) → 1 AZN/kq
3. [x] Resept vahidi yoxdursa kq sayılır — vahid məcburidir
4. [x] Yeni xammal qalıqla yaradılanda sənəd/hərəkət yox idi → «İlk qalıq»

### Yerləşmə
5. [x] Məhsullar: qrup/stansiya formu həmişə açıq idi → + ilə açılır
6. [x] Ayarlarda ofisiant yaratmaq İstifadəçilərlə təkrarlanırdı → silindi
7. [x] «Digər» itirdi → «Ofis»
8. [x] Banner: uğur və xəta eyni qırmızı idi → yaşıl / qırmızı / sarı
9. [x] `window.confirm` oyuncaq idi → kassa təsdiq pəncərəsi (Promise, Bəli gözlənilir)

### Kassada çatışmayan
10. [x] Qonaq sayı (masa hesabında)
11. [x] Təchizatçı siyahısı (alışda)
12. [x] Anbar hərəkət cədvəli (Tarix tabında)
13. [x] Mətbəx gözləmə vaxtı — artıq var (`ageText`)

### Növbəti (unutma)
14. [x] Məhsul əlavəsi / sous / porsiya variantı (xammal yazılsa anbardan çıxır)
15. [x] Kurs (soğuk/isti çıxış növbəsi)
16. [x] E-kassa növbə + VÖEN/obyekt (rəsmi NMQ bağlı deyil, vergiyə getmir)
17. [x] Avtomatik test (`npm test`)
18. [x] Vizual: serif başlıq, yığcam çek düymələri

### Bug (analiz 7.09 günorta) — dərhal
19. [x] Bölünmüş ödəniş: hər dəfə qalan/N — N payda bitmir
20. [x] Qismən ödənişdən sonra böyük endirim hesabı 0-la bağlayır, geri yoxdur
21. [x] Növbə çekmecəsi bütün kassaları bir hovuza yığır
22. [x] Rezerv ilkin nağdı növbəyə düşmür
23. [x] Geri ödəniş anbarı bərpa etmir
24. [x] Çıxış əvvəl session silir — masa kilidi qalır
25. [x] «Ofisiantı dəyiş» mətbəx PIN-i ilə masanı atıb gedir
26. [x] Bonus/çek ofisiantı ödəyənin adınadır, masanı açanın yox
27. [x] 4–5 rəqəmli PIN serverdə məcburi dəyişilmir
28. [x] Jurnalı Kassir də `reports.view` ilə oxuya bilər
29. [x] Banner: xəta çox yerdə yaşıl (`say`ə `err` verilmir)
30. [x] Köçürmədən sonra köhnə masanın kilidi qalır
31. [x] Ləğv olunan rezervin ilkin ödənişi itir
32. [x] Porsiya/sous mayası hesabatda baza qiymətlə yazılır
33. [x] Qonaq sayı qəbuldan əvvəl yeniləyəndə uçur

### Sonra (xüsusiyyət, bug deyil)
34. [x] Bəxşiş (xidmət faizindən ayrı)
35. [x] Pulsuz / complimentary sətir
36. [x] Açıq hesabı başqa ofisianta vermək

### Restoran boşluqları (7.09 axşam)
37. [x] Masa birləşdir / ayır
38. [x] Götür / çatdır (dine-in-dən ayrı)
39. [x] Gözləmə növbəsi (waitlist)
40. [x] Allergen (məhsul + mətbəx)
41. [x] 86 / bitib (blokdan ayrı)
42. [x] Növbə içində nağd çıxarış
43. [x] Satışda VÖEN / şirkət
44. [x] Anbar sayımı (`count`)
45. [x] Zay səbəbi (xarab, töküldü, ev)
46. [x] İşə giriş / çıxış (time clock)

### Restoran (7.09 axşam-2) — e-kassa istisna
47. [x] 86 günün əvvəlində sıfırlanır
48. [x] Çatdırma ünvan / kuryer
49. [x] Növbəni masaya oturtma
50. [x] İş qrafiki (istifadəçi, Yadda saxla)
51. [x] Expeditor / çıxış (mətbəx tabı)
52. [x] Happy hour qiymət
53. [x] Kombo (məhsul ID-ləri)
54. [x] Hədiyyə kartı
55. [x] Bəxşiş hovuzu
56. [x] Müştəri ekranı (`/display.html`)

### Bug (analiz 7.09 axşam)
57. [x] Hədiyyə kartı ödəniş xətasından əvvəl silinir, geri qayıtmır
58. [x] Geri ödəniş hədiyyə kartını bərpa etmir
59. [x] Çekdə ödənilib hədiyyəni saymır (bölünmüş pay səhv)
60. [x] Takeaway / Çatdır kilidsiz — iki terminal eyni bileti ödəyə bilər
61. [x] 86 sıfırlanması kataloq oxunuşunda yazır — eyni anda saxlama silinə bilər
62. [x] Happy hour qiyməti menyuda görünmür
63. [x] Növbə bağlama bütün kassaların açıq hesabına baxır
64. [x] Komboda tapılmayan uşaq məhsul səssiz keçir
65. [x] Bəxşiş hovuzu işdə olan hərkəsi (mətbəx də) sayır
66. [x] Müştəri ekranı son toxunulan istənilən masadır
67. [x] İş qrafiki yazılır, heç yerdə yoxlanılmır

### Bug (analiz 7.09 axşam-3)
68. [x] Takeaway / Çatdır kilidi 60 saniyəyə düşür (ping yox)
69. [x] Kombo ləğv uşaq sətirləri qoymur
70. [x] Bağlanmış çekdə bəxşiş uçur
71. [x] Çekdə hədiyyə kartı görünmür
72. [x] Növbə cəmi hədiyyəni saymır
73. [x] Qonaq / ünvan kilidsiz yazılır
74. [x] Happy hour qiyməti səhifə açıq qalsa köhnəlir
75. [x] Users / Ayarlar / Növbə xəta banneri yaşıl
76. [x] terminalId-siz açıq bilet növbə bağlamağı keçir

### Bug (analiz 7.09 axşam-4)
77. [x] Növbə açılmadan satış olur
78. [x] Birləşmiş masada yalnız 1 kilid — əsas masa boş qalır
79. [x] Geri ödənişdən sonra bəxşiş hovuzu yenə sayır
80. [x] Növbə «Oturtdu» dolu/rezerv masanı yoxlamır
81. [x] Takeaway/çatdırılmanı zal masasına köçürmək olmur
82. [x] Ayır masanı boşaldır, sətirlər köhnə çekdə qalır
83. [x] Yalnız hədiyyə ödənişi növbədə «nağd» yazılır
84. [x] Hesabat hədiyyə üsulunu göstərmir
85. [x] Anbar / kataloq / hədiyyə / növbə `withLock`siz yazılır
86. [x] Ofisiant hesabatında tarix xətası yaşıl banner
87. [x] Kurs gözləyən sətirin anbarı qəbulda yoxlanılmır

### Bug (analiz 7.09 axşam-5)
88. [x] Boş masaya keçid birləşmiş kilidləri atır
89. [x] Takeaway bileti keçiddə kilidsiz qalır
90. [x] Çıxış yalnız seçili masanı açır
91. [x] Geri ödəniş göndərilməmiş kursu anbara qaytarır
92. [x] Ödəniş A növbəsinə, nağd B çekmecəsinə düşür
93. [x] Rezerv ilkin ödəniş növbəsiz keçir
94. [x] Ayırdıqda boş açıq çek / qonaq 0
95. [x] «Oturtdu» masa boş görünür — ikinci növbə/rezerv
96. [x] Müştəri ekranı son toxunulan masadır
97. [x] Takeaway → zal «Köçür» gizli
98. [x] Hesabat cəmində hədiyyə yoxdur; qarışıq üsul nağd
99. [x] Qismən ödənişdən sonra çek pəncərəsi açılır
100. [x] Zal / ayarlar / istifadəçi / printer `withLock`siz

### Növbəti (8.09)
101. [x] Sətir / oturacaq ödənişi — seçilən hissə ödənilir, qalıq masada qalır
102. [x] SMS — Ayarlarda operator + Yadda saxla; rezerv / növbə mətni
103. [x] Oflayn — kəsintidə xəbərdarlıq, qəbul/ödəniş növbəsi, qayıdanda göndər
104. [x] Filial — çekdə ad + hesabat filtri (ayrı baza sonra)
105. [x] Quraşdırıcı + GitHub avtoyeniləmə — Windows quraşdır, avtobaşlat, repo-dan yenilə

### Növbəti (8.09 axşam)
106. [x] Lisenziya kodu — açılışda tələb, Ed25519 + maşın bağı
107. [x] Ad: Arpos Restoran; hər yeniləmədə versiya
108. [x] EXE quraşdırıcı
109. [x] GitHub: ARPOS Restoran
110. [x] EXE+versiya məcburi; avtobackup/GitHub; avtoyeniləmə; lisenziya açarı gizlidir
111. [x] 1.1.2 — kəsr nöqtə/vergül, xammal saysız, masa pingi, EXE ikon
112. [x] 1.1.3 — GitHub-dan yeniləmə işlək qovluğa yazılır
113. [x] 1.1.4 — Setup görünür; ikinci Quraşdır Failed to fetch izahı
114. [x] 1.1.5 — Ayarlarda repo və token görünmür
115. [x] 1.1.6 — Ayar düymələri qısa, panel səliqəli
116. [x] 1.1.7 — Sifariş kart ölçüsü brauzer + kassa yaddaşı
117. [x] 1.1.8 — Kart ölçüsü proqram bağlananda da qalır
118. [x] 1.1.9 — Kassa / hesabat / anbar / məhsul düymələri qısa
119. [x] 1.1.10 — Çertyoj otaq ölçü/ad, xana, masalı silmə icazəsi
120. [x] 1.1.11 — Açılışda PIN banneri kassiri əllə bağlatmır
130. [x] 1.1.12 — Z çap, hesabat CSV, az qalıq, ödəniş qalığı
131. [x] 1.1.13 — Barkod, oflayn növbə, çatdırılma statusu

### Professional (9.09)
121. [x] Növbə bağlananda çap olunan Z (nağd/kart/hədiyyə/çıxarış)
122. [x] Hesabat CSV
123. [x] Anbarda az qalıq banneri (min > 0)
124. [x] Ödənişdə qalıq avtomatik (nağd/kart)
125. [ ] Kart POS terminalı — model deyəndə
126. [x] Çekmecə kick (nağd çek / Z)
127. [x] Barkod / sürətli kod
128. [x] Oflayn: köçür/mətbəx də növbə
129. [x] Çatdırılma statusu (yolda/çatdı)

## Bitdi (əvvəlki)
- Ehtiyat nüsxə, terminallar, endirim, çap, PIN, növbə, anbar, alış, menyu bölgüsü (zal / ofis)
- Ofisiantı dəyiş, əməliyyat jurnalı

## Qiymət
İşlək restoran kassası. 1–124 və 126–129 bağlandı. 125 (kart POS) model deyəndə.
