# Qanot AI 0.6.5 Liquid Moshi — mahalliy tekshiruv

2026-10-11, Windows x64. Bu mahalliy working tree va installer tekshiruvi;
GitHub push, tag yoki yangi Release bajarilmadi. Boshlang‘ich commit `702f925`.

## Natija

- Frontend: **662/662 PASS**, yakuniy manba bo‘yicha.
- Rust workspace, `cargo test --workspace --locked`: **306/306 PASS**
  (ilova 276, hook 30); registry dependency versiyalari saqlangan.
- TypeScript, production Vite, native release build va NSIS/MSI pack: **PASS**.
- Thinking Orbs: 9 holat × 2 o‘lcham × 4 vaqt, **72 upstream geometriya namunasi**.
- Liquid testlari radius/o‘lcham tinishidan keyingi raster yangilanishini,
  yashirin/offscreen resurs tozalashini, mavjud DOM va drag transform saqlanishini
  hamda shaffof Moshi materialini tekshirdi.
- Browser: haqiqiy Moshi preview, shipping panel va Studio, to‘q/yorug‘ fon va
  bo‘limlar almashishi tekshirildi; kuzatilgan console’da **0 xato**.
- `git diff --check`: PASS. Vendor manbalari va qotirilgan revisionlar
  [Liquid qo‘llanmasida](README-LIQUID-UZ.md). To‘liq MIT notice’lar installer
  ichidagi `INSTALL-UZ.md` fayliga ham kiritilgan.

## Paketlar

Ikkala installer chiqarib tekshirildi; ularni bajarishdan avval native/hook/guide
va runtime hashlari joriy build bilan solishtirildi. Har paketda **2072 payload
fayli**, shu jumladan **2068 runtime fayli**; tekshiruvda private fayl **0**.
Frozen runtime manifesti va 571,951,706 bayt runtime tarkibi o‘zgarmagan.

| Fayl | Bayt | SHA256 |
| --- | ---: | --- |
| `QanotAI-Windows-0.6.5-setup.exe` | 422374173 | `3174e14c2bb6133f667a96b3335672e814f72808a625d29393c4526f1251dbb3` |
| `QanotAI-Windows-0.6.5.msi` | 455159984 | `69ee42d6d29efa780b0691643d05f51e07b8f4ce94fa615978b3079c161f980f` |
| `coucou.exe` | 7284736 | `610ed04c592a8cd03166da605276eb4119b30e954e378ebf9cba08b44bde409e` |

## Haqiqiy o‘rnatish

Mavjud Qanot AI **0.6.4 → 0.6.5** yangilandi. Avval bounded private backup
yaratildi; faqat shu o‘rnatmaning tekshirilgan idle jarayoni to‘xtatildi. NSIS
faqat `/S` bilan, destination override yoki avtomatik installer launch’siz bajarildi.
11435 dagi boshqa xizmat saqlandi.

Yangi ilova ochilishidan **oldin** settings va barcha mavjud DPAPI fayllari
byte-identical ekani tasdiqlandi. O‘rnatilgan EXE/hook/guide va barcha runtime
hashlari yangi paket/frozen manifestga mos. Ilova `--studio` bilan ochildi;
11437 loopback xizmati yangi ilovaning o‘z child jarayoni sifatida tayyor bo‘ldi.
Saqlangan Telegram sessiyasi **connected/authorized** holatiga qaytdi. Panel
ham mavjud ilovaning standart CLI orqali ochildi.

Bu vizual yangilanish sinovida Telegram xabari yuborilmadi, mikrofon yozuvi
olinmadi va shifrlangan credentials ochib o‘qilmadi. Private backup va raw
tekshiruv hisobotlari repository/installerga qo‘shilmagan.

## Tekshiruv chegarasi

Browser preview WebView ichidagi SVG sinishi va animatsiyalarni tekshiradi.
Native ish stoli fonini capture qilish yoki DWM refraction qo‘shilmagan;
Windows oynalari shaffof bo‘lib, tashqi fonni ko‘rsatadi. Native oynalarning
ko‘rinishini avtomatik screenshot bilan tekshirish bu sessiyada mavjud emas edi.
Inson bilan mikrofon/xona sinovi, MSI’ni haqiqiy o‘rnatish va toza VM sinovi
hali bajarilmagan; MSI uchun extraction/hash tekshiruvi bajarilgan.
