# Qanot AI + LocalAI Studio 0.6.4 — Moshi

Windows 10/11 x64 uchun yangi besh burchakli animatsion Moshi hamrohi; Telegram, panel, providerlar va mahalliy ovozli boshqaruv saqlanadi.

Manba va mahalliy installer tekshiruvlari yakunlandi. GitHub upload holati, source commit va barcha asset SHA256 digestlari nashrdan so‘ng publisher va alohida verifier bilan tekshiriladi.

## Moshi va agentlar

Moshi asl Mochi personajining yumshoq besh burchakli moslashtirishidir. Oq-kulrang material, qora ko‘zlar, soyalar, yuz ifodalari va kiyim uslubi Mochi’dan saqlanadi/moslanadi; tana geometriyasi va agent bezaklari yangilanadi. Animatsiya holatlari avvalgi MIT koddagi panel mexanizmiga ulanadi. Telegram, Codex, OpenCode va boshqa agentlar shu oilaga mos bezak/ranglardan foydalanadi; subagentlar o‘z ota agenti uslubining rang variantini oladi.

Panelning chet/burchaklarga moslashuvi, ixchamlash, saqlangan joylashuv, LocalAI Studio, Telegram chat/xabar/AI buyruqlari, Ollama/Gemini/Groq, CMD/PowerShell, GitHub va mahalliy ovozli boshqaruv saqlanadi. Ichki `coucou.exe`, hook/protokol nomlari va per-user credential/settings yo‘llari eski o‘rnatmalar bilan moslik uchun o‘zgarmaydi.

Ixtiyoriy davomli tinglashda yangi asosiy ibora **«OK Moshi»**; **«OK Qanot»**, **«OK Coucou»** va **«OK Kuku»** moslik uchun ishlaydi. Frozen ASR/TTS modellari o‘zgarmaydi; iboralarni frontend tanlaydi.

## Yuklamalar

- **QanotAI-Windows-0.6.4-setup.exe** — tavsiya etilgan per-user EXE installer.
- **QanotAI-Windows-0.6.4.msi** — Windows Installer formati.
- **QanotAI-Windows-0.6.3-runtime.zip** — manbadan yig‘ish uchun frozen runtime. Nom, hajm va SHA256 o‘zgarmaydi; u yangi **v0.6.4** Release’ga biriktiriladi.

Runtime ZIP: **454608149 bayt**, SHA256 `79bad9bbf4cff6bf9312e9dbc45ff9dedae44f321872c5d66c01d219cf8ddea0`; **2068 fayl**, payload **571951706 bayt**. 0.6.4 native/frontend shu manbadan yangidan yig‘iladi. Xizmat, Python, nutq modellari, GitHub CLI va notification ovozlarining frozen fayllari o‘zgarmaydi.

Start menyusidan **Qanot AI LocalAI Studio**’ni oching. Python, Node.js yoki Rust alohida kerak emas; WebView2 kerak. Ollama va katta chat modellari alohida o‘rnatiladi. Installer hali code-signing bilan imzolanmagan.

## Tekshiruv va cheklov

**O‘tdi:** frontend 651/651, Rust 306/306, TypeScript/Vite/native build, shipping Mochi asosidagi Moshi renderer (browser console 0 xato), ikkala EXE/MSI extraction/hash/version/x64 va barcha 2068 frozen runtime fayli. Haqiqiy `/S` EXE yangilash 0.6.3 → 0.6.4 bajarildi; sozlamalar va shifrlangan Telegram fayllari launch’dan oldin saqlandi, Studio/xizmat ochildi va Telegram saved-session connected/authorized bo‘ldi. Sinovda xabar yuborish yoki mikrofon capture bajarilmadi.

Dalillar `VERIFICATION-0.6.4-UZ.md` va `SHA256SUMS.txt`ga kiritiladi. 0.6.3 natijalari yangi installer sinovi sifatida ko‘rsatilmaydi. Haqiqiy mikrofon/xona, MSI o‘rnatish va clean-VM sinovi hali bajarilmagan.

```powershell
Get-FileHash .\QanotAI-Windows-0.6.4-setup.exe -Algorithm SHA256
```

Telegram faqat aniq yuborish amali/buyrug‘i bilan xabar yuboradi; noma’lum natija avtomatik takrorlanmaydi. Mikrofon avtomatik yoqilmaydi. Cloud chat providerlari va Telegram internet talab qiladi.

## Litsenziyalar va manba

Asl MIT kod: [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou), Louis Raillé. Qanot ikonkalari va 29 notification ovozi `LICENSE-QANOT-ASSETS.md` bo‘yicha MIT. Moshi renderer kodi asl MIT attribution’ini saqlaydi. Moshi materials/ko‘zlar/kiyimlar va preview Mochi artwork’idan moslashtirilgan; ular mustaqil original media yoki MIT artwork sifatida ko‘rsatilmaydi. `LICENSE-ASSETS.md` shartlari va foydalanuvchi tasdiqlagan yozma ruxsat qo‘llanadi; ruxsatning shaxsiy matni relizga kiritilmaydi.

NavAI Apache-2.0, Whisper/whisper.cpp va Silero MIT, eSpeak NG GPLv3. Runtime tegishli license/provenance va eSpeak manba arxivini o‘z ichiga oladi. Build helper v0.6.4 Release’dagi frozen runtime URL’ni tekshiradi; eski Release’ni olib tashlash yangi fayl yuklanib va tekshirilib bo‘lgach bajariladi.
