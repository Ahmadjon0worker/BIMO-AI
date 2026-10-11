# Qanot AI 0.6.3 — Windows relizi tekshiruvi

Sana: 2026-10-11. Maqsadli platforma: Windows 10/11 x64.
Quyidagi bajarilgan sinovlar joriy Windows x64 kompyuterida va alohida test
papkalari/registr kalitlarida tekshirildi. Toza Windows o‘rnatmasi sinovi quyida
alohida ko‘rsatilgan.

## Kod va xizmat testlari

| Tekshiruv | Natija | Qamrov |
| --- | --- | --- |
| Frontend testlari | **642/642 o‘tdi**; xato va skip yo‘q | Panel, Studio, Telegram/ovoz buyruqlari, tarjimalar, yangi personaj va paket tanlash regressiyalari |
| Rust workspace testlari | **306/306 o‘tdi** | Ilova kutubxonasi: 276; hook: 30; `--workspace --offline --locked` |
| Python xizmat testlari | **189 ta bajarildi: 188 o‘tdi, 1 skip** | Telegram, router, provider va mahalliy vositalar/ovoz protokoli testlari |
| NSIS migratsiya sinovlari | **14/14 o‘tdi** | O‘ziga tegishli eski o‘rnatma, boshqa destination/publisher/path, autostart va mavjud yangi qiymatlarni saqlash |
| Yakuniy production build va EXE/MSI arxivlarini tekshirish | **O‘tdi: TypeScript/Vite va production Rust; yakuniy EXE/MSI x64 payload xeshlari mos** | Yangi product/version, x64, native app/hook/guide va barcha runtime fayllari |

Python’da o‘tkazib yuborilgan bitta test — ommaviy ovoz assetlari bilan alohida
yoqiladigan offline synthetic smoke testi. U o‘tgan test sifatida hisoblanmadi.
O‘rnatilgan native ASR bilan ommaviy audio sinovi alohida bo‘limda qayd etiladi.
Testlarning bir qismi fake provider/Telegram client va vaqtinchalik storage
ishlatadi; ularning o‘tishi haqiqiy akkaunt yoki cloud inference ishlaganini
o‘z-o‘zidan tasdiqlamaydi.

Rust’ning yangi 6 ta autostart testi bo‘shliq va Unicode bor executable yo‘lini
qo‘shtirnoqqa olishni, boshqa buyruqlar va registr turlarini saqlashni, yo‘q yoki
allaqachon qo‘shtirnoqqa olingan qiymatga tegmaslikni tekshirdi. Sinovlar alohida
inert registr kalitlarida o‘tdi; haqiqiy `Run`, `StartupApproved` va foydalanuvchi
sozlamalari o‘zgartirilmadi. Ilovadagi tuzatish faqat foydalanuvchi autostartni
yoqib, plugin muvaffaqiyatli qaytganidan keyin uning aynan mos o‘z qiymatiga
qo‘llanadi.

NSIS’ning 14 ta fixture sinovida haqiqiy registr/AppData/shortcut joylari
alohida test joylari bilan almashtirildi. Sinov kalitlari tozalandi. O‘chirilgan
autostart override saqlanishi, yangi string/bo‘sh/DWORD/binary qiymatlarga
tegmaslik, mavjud approval va begona command’ni saqlash tekshirildi. Bu
fixture sinovlari haqiqiy installer yangilash natijasidan alohida dalildir.

## Yangi ikonka, personaj va ovozlar

Qanot AI ommaviy Windows paketida yangi Qanot personaji, yangi geometrik ikonka
va mustaqil sintezlangan **29 ta ovoz** ishlatiladi. Asl kodning MIT attribution’i
va yangi assetlarning MIT bildirishnomasi saqlangan.

- 4 ta PNG va 7 o‘lchamli ICO tekshirildi: 16, 24, 32, 48, 64, 128, 256 px.
- 29 WAV: PCM16, mono, 44 100 Hz; fayl tuzilishi va xeshlar tekshirildi.
- Generatorlarni qayta ishlatish bir xil natija berdi.
- Yangi ikonka va ovoz baytlari upstream media xeshlaridan farq qiladi;
  generator manbasi yangi ovozlarning sintez jarayonini ko‘rsatadi.
- Ovoz manifesti SHA256:
  `c8e2c38d9828cc2f2ad7dd9b96724cd36f75fc779705742cd3b912934779f4f5`.
- Ikonka manifesti SHA256:
  `a42ac5245be80f3f5fe3dc61fceedaa1b406b1cb8bc53617b757f81f0feec715`.

Bu tekshiruv assetlarning tuzilishi va kelib chiqishi haqida. Haqiqiy karnaydan
ijro qilish yoki mikrofon orqali eshitish sinovi bajarildi degan da’vo yo‘q.

## Runtime ZIP va manbadan yig‘ish

`QanotAI-Windows-0.6.3-runtime.zip` tarkibi **2 068 payload fayli** va bitta
runtime manifestidan iborat. Payload hajmi: **571 951 706 bayt**; ZIP hajmi:
**454 608 149 bayt**. Xizmat protokol nomi `coucou-localai-service`, xizmat
versiyasi `1.3.1`; eski moslik nomlari ilovaning ommaviy nomidan mustaqil.

- ZIP SHA256:
  `79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0`.
- Runtime manifest SHA256:
  `ecc66b90c2bddddbe9d140ea014805ec8366218c1d80a08cdbec303533e7c2e4`.
- Manifest hajmi: **385 602 bayt**. ZIP a’zolari: **2 069**.
- Arxivni tekshirish, yangi alohida source fixture’ga joylash va joriy xizmat
  manbasini sinxronlash o‘tdi. Fayllar ro‘yxati va barcha xeshlar aynan mos.
- **8 ta xavfli yo‘l varianti** qabul qilinmadi. Mavjud boshqa faylni xavfli
  ustidan yozish ham rad etildi. Asosiy tayyor bundle manifesti o‘zgarmadi.
- Ushbu bootstrap sinovi internet, ilova ishga tushirish yoki to‘liq build
  ishlatmagan; tayyor mahalliy arxiv bilan bajarilgan.
- ZIP/installer payload’iga foydalanuvchi sozlamalari, akkaunt sessiyalari,
  credential, shaxsiy chat tarixi va audio yozuvlar kiritilmaydi.

## Haqiqiy yangilash va o‘rnatilgan xizmat

| Tekshiruv | Yakuniy natija |
| --- | --- |
| EXE’ni `/S` bilan standart migratsiya orqali o‘rnatish | **O‘tdi: /S, /D berilmagan, installer exit code 0** |
| Eski ro‘yxatdan o‘tgan o‘rnatma manzili va yangi Qanot AI 0.6.3 registration | **O‘tdi: tekshirilgan eski papka qayta ishlatildi; Qanot AI 0.6.3 / Ahmadjon0worker; tegishli eski uninstall yozuvi olib tashlandi** |
| Native app, hook, guide va 2 068 runtime fayli xeshlarini o‘rnatilgan joyda tekshirish | **O‘tdi: app, hook, guide va 2068 runtime fayli xeshlari mos** |
| Panel sozlamalari va shifrlangan DPAPI credential fayllarini installer davomida saqlash | **O‘tdi: oldin/keyin xeshlar mos; app ishga tushishidan oldin tekshirildi** |
| Studio ishga tushishi va yangi ilovaga tegishli loopback xizmat | **O‘tdi: LocalAI Studio - Qanot AI oynasi mavjud, xizmat yangi app’ga tegishli; health OK** |
| Telegram saqlangan sessiya bilan qayta ulanishi | **O‘tdi: connected=true, authorized=true; yangi xabar yuborilmadi** |

Yangilash sinovida installerga `/D` destination override berilmaydi. Oldingi
o‘rnatmaning joriy foydalanuvchi registration’i, publisher’i va yo‘llari mosligi
tekshirilgach, standart installer migratsiyasi tekshiriladi. Foydalanuvchi
sozlamalari hamda DPAPI fayllarining oldin/keyin xeshlari faqat shaxsiy test
hisobotida qoladi; bu ommaviy faylga ularning qiymatlari yoki xeshlari qo‘shilmaydi.

Telegram qayta ulanish natijasi ulanish holati bilan chegaralanadi. Bu tekshiruv
uchun yangi xabar yuborish talab qilinmaydi; yangi xabar yuborilmadi. Ushbu 0.6.3 dalili
ulanishni tasdiqlaydi; xabar yuborish sinovi deb ko‘rsatilmaydi.

## O‘rnatilgan o‘zbekcha ASR

Sinov o‘rnatilgan yangi app va unga tegishli loopback xizmat
identity/xesh tekshiruvlari o‘tgach bajarildi. Pinned ommaviy Google FLEURS
`uz_uz` row 0 audiosi (9,78 soniya, CC-BY-4.0) va deterministik nutqsiz
kontrollar ishlatildi. Mikrofon yozib olinmaydi, tanilgan matn command sifatida
dispatch qilinmaydi, TTS/audio playback yoki Telegram yuborish bajarilmaydi.

| Tekshiruv | Yakuniy natija |
| --- | --- |
| NavAI Uzbek model va Silero VAD hash/identity | **O‘tdi: navai-small-uz-q5_1 + Silero 6.2.0; pinned model/runtime xeshlari mos** |
| Ommaviy FLEURS row 0 tanish natijasi, WER/CER va ishlash vaqti | **O‘tdi: 16 normalizatsiyalangan so‘z, WER/CER 0%; HTTP 5000 ms, decoder 5000 ms** |
| 50 Hz hum, oq shovqin va raqamli sukunat nazoratlari | **3/3 o‘tdi: matn bo‘sh, speech_detected=false** |
| Xizmatning bo‘sh/faol holatga qaytishi, temp fayllarni tozalashi | **O‘tdi: busy=false, vaqtinchalik fayllar tozalandi, Telegram holati o‘zgarmadi** |

Bir audio uchun aniq mos natija umumiy nutq aniqligi bahosi emas. Alohida
`VOICE-UZ-BENCHMARK.md/json` dagi 8 ta ommaviy audio bo‘yicha 0.6.2 natijalari
tarixiy taqqoslash bo‘lib qoladi; ular yangi 0.6.3 installer haqiqiy sinovi
o‘rniga ko‘rsatilmaydi. Shovqin, talaffuz, ismlar va Telegram username’larda
xatolar qolishi mumkin.

## Yakuniy yuklamalar va SHA256

| Fayl | Bayt | SHA256 |
| --- | ---: | --- |
| `QanotAI-Windows-0.6.3-setup.exe` | **422418889** | **4a98b890f49b445f4b39fd7fdc35a32513900b9c6f78cdac1d67944f252d2848** |
| `QanotAI-Windows-0.6.3.msi` | **455119024** | **6398fdd053991ae2df691c2c97cfcd700663aa4849982f80e21071ec32f197b8** |
| `QanotAI-Windows-0.6.3-runtime.zip` | 454608149 | `79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0` |

Relizdagi `SHA256SUMS.txt` bilan tekshiring:

```powershell
Get-FileHash .\QanotAI-Windows-0.6.3-setup.exe -Algorithm SHA256
Get-FileHash .\QanotAI-Windows-0.6.3.msi -Algorithm SHA256
```

## Hali bajarilmagan tekshiruvlar

- **Haqiqiy mikrofon, xona shovqini va karnay:** foydalanuvchi kompyuterga
  qaytguncha kechiktirilgan. Mikrofon avtomatik yoqilmagan.
- **MSI’ni haqiqiy o‘rnatish:** bajarilmagan; paketdan fayllarni chiqarib
  tekshirish MSI o‘rnatish sinovi bilan bir xil emas.
- **Toza VM/fresh-install:** bajarilmagan; mavjud Windows kompyuteridagi
  yangilash natijasi barcha yangi Windows tizimlariga umumlashtirilmaydi.

Installer hali kod bilan imzolanmagan. WebView2 yo‘q tizimda uni installer
internet orqali o‘rnatishi kerak; bu holat toza VM sinovisiz alohida tasdiqlanmagan.
O‘rnatish tafsilotlari `INSTALL-UZ.md`, vositalar `TOOLS-UZ.md`, ovoz
sozlamalari `VOICE-UZ.md` va source repository README’da berilgan.
