# Qanot AI 0.6.4 — Moshi relizi tekshiruvi

Sana: 2026-10-11. Ushbu hujjat 0.6.4 uchun yangi dalillarni jamlaydi.

**Holat: mahalliy 0.6.4 tekshiruvlari o‘tdi. GitHub metadata/upload/digest tekshiruvi nashrdan keyin alohida bajariladi. Avvalgi ovoz dalillari tarixiy deb belgilangan.**

| Tekshiruv | Natija | Doira |
|---|---|---|
| Moshi pentagon va agent/subagent dizaynlari | **O‘tdi** | Canvas, rang/oila, animatsiya holatlari va harakat |
| Frontend testlari | **O‘tdi: 651/651** | Yakuniy Mochi asosidagi yumshoq Moshi renderer va integratsiya holatlari |
| TypeScript | **O‘tdi** | Joriy frontend type-check |
| Production Vite build | **O‘tdi** | Installerga kiradigan frontend |
| Rust workspace testlari | **O‘tdi: 306/306** | Native app 276 + hook 30; joriy 0.6.4 manbasi |
| Production native build | **O‘tdi** | Native app va hook 0.6.4; installer bundling alohida tekshiriladi |
| Browser’da shipping Moshi renderer | **O‘tdi: console’da 0 xato** | Moshi/Codex/OpenCode/Telegram pentagon va wave ko‘rildi; bu haqiqiy installed WebView sinovi emas |
| Bootstrap manzili va frozen runtime ZIP | **O‘tdi: tarmoqsiz verify-only** | v0.6.4 download pin, oldingi SHA256 va 2068 arxiv fayli |
| Installer frozen runtime / source freshness | **O‘tdi: 2068 fayl xeshlari mos** | Yakuniy 0.6.4 paketda 2068 payload fayli byte-identical |
| EXE va MSI extraction/hash/version/x64 | **O‘tdi: ikkala installerning aynan joriy payload’i** | Yangi 0.6.4 installerlar |
| Haqiqiy EXE yangilash / sozlama va sessiya xeshlari | **O‘tdi: /S; launch’dan oldin sozlama/DPAPI byte-identical** | Shu Windows foydalanuvchisining o‘rnatmasi |
| LocalAI Studio va unga tegishli service | **O‘tdi: yangi app owns ready service** | Faqat owned process/loopback service |
| Telegram saqlangan sessiya bilan ulanishi | **O‘tdi: connected/authorized; yangi xabar yuborilmagan** | Yangi outbound xabar talab qilinmaydi |
| GitHub main/tag/Release va asset digestlari | **Nashrdan so‘ng publisher va alohida verifier tekshiradi** | Exact commit va barcha upload fayllari |

Moshi — Mochi asosidagi yumshoq besh burchakli moslashtirish. Renderer kodi MIT attribution’ini saqlaydi; materiallar, ko‘zlar, kiyimlar va preview uchun asl artwork shartlari hamda foydalanuvchi tasdiqlagan yozma ruxsat qo‘llanadi. Avvalgi Qanot icon/sound xeshlari va litsenziyalari o‘zgarmaydi.

## Saqlangan runtime

Native va frontend ilova versiyasi **0.6.4**. Xizmat/runtime/modellar o‘zgarmaydi: aynan **QanotAI-Windows-0.6.3-runtime.zip** yangi **v0.6.4** Release’ga yuklanadi. Nomini o‘zgartirish yoki ZIP’ni qayta yaratish talab qilinmaydi. Source bootstrap `release_version: 0.6.4` va oldingi runtime `version: 0.6.3`ni alohida tekshiradi.

| Artefakt | Bayt | SHA256 |
|---|---:|---|
| `QanotAI-Windows-0.6.4-setup.exe` | 422226420 | `0f891cc9a89032d0cfa53986a2c382139c3cf07f55d478eee10df2b666d652eb` |
| `QanotAI-Windows-0.6.4.msi` | 455135408 | `a1d6790437538911214ce6dc4e0ebc00997d079a304a330ec4a0665408bedb4b` |
| `QanotAI-Windows-0.6.3-runtime.zip` | 454608149 | `79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0` |
| Frozen runtime manifest | 385602 | `ecc66b90c2bddddbe9d140ea014805ec8366218c1d80a08cdbec303533e7c2e4` |

Payload: **2068 fayl / 571951706 bayt**. Foydalanuvchi akkaunti, kalit, Telegram sessiyasi, log, audio capture yoki workspace hujjatlari runtime ZIP ichiga kiritilmagan.

## Tarixiy ovoz dalili

O‘zgarmagan model uchun 0.6.3 da o‘rnatilgan xizmat bitta 9,78 soniyalik Google FLEURS o‘zbekcha audio namunasida 16 so‘z va WER/CER 0% berdi. Hum/shovqin/sukunat bo‘sh natija berdi. Oldingi 8 ommaviy audio benchmarkida WER 20,66%, CER 7,99% bo‘lgan. Bu natijalar mikrofon/xona aniqligi yoki yangi 0.6.4 installerning tasdig‘i emas.

## Hali bajarilmagan sinovlar

- Haqiqiy foydalanuvchi mikrofoni, xona shovqini va karnaydan tinglash.
- MSI’ni haqiqiy install/uninstall qilish va boshqa toza Windows VM.
- Installer code-signing sertifikati va WebView2 yetishmagan toza tizim.

Mahalliy 0.6.4 natijalari yangi installer va uning haqiqiy yangilash daliliga bog‘langan. Hisobot ommaviy variantida shaxsiy host yo‘llari, process ID, Telegram metadata yoki credential fingerprintlari berilmaydi.
