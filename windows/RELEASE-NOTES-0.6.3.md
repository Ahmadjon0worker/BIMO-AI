# Qanot AI + LocalAI Studio 0.6.3

Windows 10/11 x64 uchun panel, LocalAI Studio, Telegram va mahalliy ovozli boshqaruv bir installerda.

## Yuklab olish va ishga tushirish

- **QanotAI-Windows-0.6.3-setup.exe** — tavsiya etilgan, joriy Windows foydalanuvchisi uchun EXE installer.
- **QanotAI-Windows-0.6.3.msi** — Windows Installer formati.
- **QanotAI-Windows-0.6.3-runtime.zip** — manbadan qayta yig‘adigan dasturchilar uchun; oddiy o‘rnatishga kerak emas.

Setup’ni o‘rnating, Start menyusidan **Qanot AI LocalAI Studio**’ni oching.
Python, Node.js yoki Rust’ni alohida o‘rnatish talab qilinmaydi. WebView2 zarur;
u yetishmasa installer internet orqali o‘rnatadi. Installer hali kod bilan imzolanmagan.

## Yangi nom va saqlangan imkoniyatlar

Qanot AI — yangi ommaviy brend; Qanot — yangi hamroh ko‘rinishi. Upstream Coucou/Mochi brendi va mediasidan mustaqil tayyorlandi. Panel, Telegram, providerlar va mahalliy ovoz imkoniyatlari saqlanadi. Davomli tinglashning asosiy iborasi «OK Qanot»; oldingi uyg‘otish iboralari ham ishlaydi.

- O‘zbekcha interfeys, sudraladigan va chet/burchaklarga moslashadigan panel, ixchamlash tugmasi va saqlanadigan joylashuv.
- Alohida LocalAI Studio, Codex hooklari, sozlanadigan yorliqlar va notification ovozlari.
- Ollama, Gemini va Groq; Auto rejimda sozlangan providerlar orasida fallback.
- Shaxsiy Telegram yoki bot: chat qidirish/filtr/sahifalar, tarix, xabar/reply, AI qoralama va aniq buyruq bilan darhol yuborish.
- Model talab qilmaydigan CMD/PowerShell, GitHub CLI va tanlangan Windows oynasi bilan ishlash.
- Internet va cloud kalitlarisiz o‘zbekcha nutqni tanish: NavAI Whisper small Q5_1 va Silero VAD 6.2.0. Ruscha/inglizcha uchun multilingual small-q5_1; javob ovozi eSpeak NG.
- Per-user saqlash: Telegram sessiyasi Windows DPAPI’da, provider kalitlari Credential Manager’da. Yangilashda sozlamalar va ishchi fayllar saqlanadi.

Ollama va katta chat modellari paketga kiritilmagan. Telegram va cloud AI internet talab qiladi.
Mikrofon avtomatik yoqilmaydi. Telegram fonda barcha chatlarga avtomatik javob bermaydi;
aniq oluvchi va yuborish amali kerak. Natijasi noma’lum yuborish avtomatik takrorlanmaydi.

## 0.6.3 tekshiruv natijalari

- Frontend **642/642**, Rust **306/306**; Python **188 o‘tdi + 1 ixtiyoriy skip**. TypeScript va production Vite/Rust build o‘tdi.
- Yakuniy EXE va MSI ichidagi app, hook, guide va **2068 runtime fayli** chiqarilib, versiya, platforma va SHA256 tekshirildi.
- Yangi EXE `/S` bilan, `/D` override’siz shu kompyuterdagi eski 0.6.2 o‘rnatmani yangiladi. Yangi Qanot AI / Ahmadjon0worker registration va barcha o‘rnatilgan payload xeshlari tekshirildi. Sozlamalar va shifrlangan DPAPI fayllari saqlandi.
- Studio va unga tegishli mahalliy xizmat ishga tushdi. Telegram saqlangan sessiya bilan qayta ulandi; 0.6.3 tekshiruvida yangi xabar yuborilmadi.
- O‘rnatilgan NavAI model 9,78 soniyalik ommaviy FLEURS audio uchun normalizatsiyadan keyin **16 so‘z, WER/CER 0%** berdi. 50 Hz hum, oq shovqin va sukunat bo‘sh natija berdi; vaqtinchalik audio tozalandi.
- NSIS migratsiyasining **14/14** ajratilgan behavior sinovi o‘tdi: eski o‘rnatma ownership’i, custom destination va o‘chirilgan autostart override’ini saqlash, mavjud yangi string/DWORD/binary qiymatlarga tegmaslik.
- Public runtime ZIP tarmoqsiz source fixture’da tekshirilib joylandi; barcha xeshlar mos, 8 ta xavfli yo‘l varianti rad etildi.

Oldingi 0.6.2 benchmarkidagi **8 ta ommaviy audio**, 66,12 soniya, WER
**115,70% → 20,66%** va CER **43,70% → 7,99%** tarixiy taqqoslashdir.
U yangi installer sinovi o‘rniga ko‘rsatilmaydi. Bu kichik sinov to‘plami;
shovqinli nutq, ismlar va username’larda xatolar qoladi.
Haqiqiy mikrofon/xona, MSI o‘rnatish va toza VM sinovi hali bajarilmagan.

O‘rnatish uchun **INSTALL-UZ.md**, ovoz uchun **VOICE-UZ.md**, tekshiruv uchun
relizdagi yangi **VERIFICATION-0.6.3-UZ.md** va **VOICE-UZ-BENCHMARK.md/json**’ni o‘qing.
Yuklamalar **SHA256SUMS.txt** bilan tekshiriladi:

```powershell
Get-FileHash .\QanotAI-Windows-0.6.3-setup.exe -Algorithm SHA256
```

Manbadan yig‘ish: repository README va `windows/scripts/RUNTIME-BOOTSTRAP.md`.
Source checkout katta model/runtime binary’larini Git’dan olmaydi; helper relizdagi
ZIP hajmi, arxiv va har bir fayl xeshini tekshiradi, so‘ng joriy xizmat manbasini joylaydi.

## Eski o‘rnatma bilan moslik

Toza EXE o‘rnatish papkasi `%LOCALAPPDATA%\Qanot AI`; tekshirilgan eski per-user o‘rnatma avvalgi papkasida yangilanadi. Eski tegishli uninstall yozuvi va yorliqlar yangi nomga almashtiriladi. Panel/provider sozlamalari va Telegram sessiyasi uchun `%APPDATA%\Coucou` hamda `%LOCALAPPDATA%\Coucou\LocalAI` saqlanadi. Credential targetlar, xizmat protokoli va `coucou.exe`, CLI/hook nomlari moslik uchun o‘zgarmaydi. Ularni qayta nomlamang.

Autostart faqat foydalanuvchi yoqqanda qo‘llanadi; bo‘shliq/Unicode bor executable yo‘li qo‘shtirnoqqa olinadi. Eski o‘chirilgan startup override’i o‘zgarmaydi, mavjud yangi yoki begona yozuvlar ustidan yozilmaydi.

## Litsenziyalar

Asl manba: [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou), muallif Louis Raillé.
Qanot ikonkalari, yangi personaj kodi va 29 sintezlangan ovoz `LICENSE-QANOT-ASSETS.md` bo‘yicha MIT. Asl kod MIT. Upstream Coucou/Mochi nomi va media alohida `LICENSE-ASSETS.md` shartlariga ega; yangi ommaviy Qanot AI brendi va ko‘rinishi mustaqil tayyorlanadi.
NavAI model Apache-2.0, Whisper/whisper.cpp va Silero MIT, eSpeak NG GPLv3.
Ularning litsenziyalari va eSpeak tegishli manba arxivi runtime ichida mavjud.
