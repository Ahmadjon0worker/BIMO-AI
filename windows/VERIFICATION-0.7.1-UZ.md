# BIMO AI 0.7.1 — tekshiruv dalillari

2026-10-12, Asia/Tashkent. BIMO AI 0.7.1 joriy Windows foydalanuvchisiga EXE installer orqali o‘rnatildi va `--assistant` bilan ishga tushirildi. Liquid Moshi, LocalAI Studio, Telegram, mahalliy ovoz modeli va Windows vositalari paketda saqlangan.

## Avtomatik tekshiruvlar

| Tekshiruv | Natija |
|---|---|
| Frontend | 712/712 PASS |
| TypeScript va production build | PASS |
| Rust | 284 ilova + 30 hook, jami 314 PASS |
| Autostart migratsiyasi | Rust jami ichidagi 10 alohida registry fixture testi PASS |
| Python regression | 233 test: 232 PASS, 1 ixtiyoriy native ovoz fixture testi skip |
| Runtime bootstrap | Muzlatilgan bazadagi 2 068 fayl SHA-256 orqali tekshirildi; relocation regression 2/2 PASS |
| Runtime self-test | Python 3.12.14, xizmat 1.4.1; 20 import PASS, private MFC va credential layout tekshirildi |
| Liquid preview | Haqiqiy frontend rendererida Moshi, Codex, OpenCode va Telegram; browser xatosi 0 |
| EXE va mahalliy MSI tarkibi | Read-only extraction PASS; har birida runtime 2 276 fayl / 580 159 099 bayt; shaxsiy fayl 0 |
| MSI identifikatori | Read-only tekshiruv PASS: BIMO AI 0.7.1; Qanot AI UpgradeCode saqlangan |

## Amaldagi o‘rnatma

NSIS EXE yangilanishi exit code 0 bilan tugadi. Ilova va barcha runtime fayllari paket hashlariga mos. Per-user o‘rnatish papkasi saqlandi; Windows uninstall yozuvi BIMO AI 0.7.1 bo‘ldi, oldingi tanilgan Qanot AI/Coucou uninstall yozuvlari olib tashlandi. BIMO AI Studio yorlig‘i tekshirildi.

Ilova qayta ishga tushishidan oldin avvalgi sozlamalar, Telegram sessiyasi va DPAPI bilan shifrlangan fayllar baytma-bayt saqlangani tekshirildi. Qayta ulanishda sessiyaning normal qayta shifrlanishi mumkin. Umumiy 11435 xizmat jarayoni va uning ishga tushish vaqti o‘zgarmadi. Shaxsiy backup va o‘rnatish hisoboti GitHub’ga qo‘shilmaydi.

O‘rnatilgan xizmatda amaliy sinov:

- Health: tayyor, mahalliy port 11437.
- Telegram: mavjud saqlangan sessiya orqali qayta ulandi; `connected`, `authorized`, `has_saved_session` — true. Yangi telefon/kod so‘ralmadi.
- Codex: «Faqat Salom deb javob ber.» so‘roviga «Salom» javobi; birinchi token 5 828 ms, jami 7 375 ms.
- Ovoz: STT va TTS tayyor, model `navai-small-uz-q5_1`; haqiqiy mikrofon yozuvi olinmadi.
- Yordamchi xotirasi: shifrlangan holat tasdiqlandi.
- Ushbu yakuniy probe’da yuborilgan Telegram xabari, mikrofon yozuvi va desktop amali — 0.

## Reliz paketlari

GitHub’ga amalda o‘rnatib tekshirilgan **EXE** chiqariladi. MSI mahalliy yig‘ildi va ichidagi fayllar tekshirildi; eski MSI o‘rnatmasining papka/startup migratsiyasi amalda sinovdan o‘tmagani sabab relizga yuklanmaydi.

| Fayl | Bayt | SHA-256 |
|---|---:|---|
| `BIMOAI-Windows-0.7.1-setup.exe` | 423 559 885 | `4558b5b43f835597cc626f562fbb2a1eb1ba16dcb7d02e421aa3c54594269639` |
| `BIMOAI-Windows-runtime-base.zip` | 454 608 149 | `79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0` |

Runtime base ZIP — manbadan yig‘ish uchun o‘zgarmagan 0.6.3 dependency bazasi; yangi v0.7.1 relizida yangi nom bilan saqlanadi. Bootstrap bazani tekshiradi, keyin joriy 1.4.1 xizmat manbalarini sinxronlaydi. Tayyor 0.7.1 EXE ichidagi runtime 2 276 fayldan iborat. Bazadagi 2 068 fayl soni installer tarkibi bilan bir xil bo‘lishi shart emas.

Relizdagi `release-manifest.json`, `INSTALLER-EXTRACTION-0.7.1.json` va `SHA256SUMS.txt` ochiq paket dalillarini beradi; ularda shaxsiy backup yoki o‘rnatish yo‘llari yo‘q. GitHub aktivlari server digestlari bilan tekshirilgach reliz e’lon qilinadi va eski reliz/teglar o‘chiriladi. Git commit tarixi va upstream litsenziyalari saqlanadi.

Haqiqiy mikrofon/xona, jonli Windows tugma bosish, toza VM va Linux installer sinovlari ushbu dalil doirasida bajarilmagan. GitHub repozitoriysi private; yuklash uchun ruxsatli GitHub hisobiga kirish kerak.
