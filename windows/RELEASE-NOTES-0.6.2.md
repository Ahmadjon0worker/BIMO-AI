# Coucou Uzbek Edition + LocalAI Studio 0.6.2

Windows 10/11 x64 uchun panel, LocalAI Studio, Telegram va mahalliy ovozli boshqaruv bir installerda.

## Yuklab olish va ishga tushirish

- **Coucou-Windows-0.6.2-setup.exe** — tavsiya etilgan, joriy Windows foydalanuvchisi uchun EXE installer.
- **Coucou-Windows-0.6.2.msi** — Windows Installer formati.
- **Coucou-Windows-0.6.2-runtime.zip** — manbadan qayta yig‘adigan dasturchilar uchun; oddiy o‘rnatishga kerak emas.

Setup’ni o‘rnating, Start menyusidan **Coucou LocalAI Studio**’ni oching.
Python, Node.js yoki Rust’ni alohida o‘rnatish talab qilinmaydi. WebView2 zarur;
u yetishmasa installer internet orqali o‘rnatadi. Installer hali kod bilan imzolanmagan.

## Imkoniyatlar

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

## Tekshiruv

- Frontend: **633/633** test; ovoz/HTTP router: **50** test. Bitta ixtiyoriy native unit smoke o‘tkazib yuborilgan; native decoder alohida ishlatilgan.
- TypeScript va production Vite/Rust build o‘tgan.
- EXE va MSI ichidagi ilova, hook va **2068 runtime fayli** chiqarilib, versiya, platforma va SHA256 tekshirilgan.
- EXE shu Windows kompyuterga o‘rnatilgan; sozlamalar va shifrlangan Telegram sessiyasi saqlangan. O‘rnatilgan xizmat saqlangan sessiya bilan qayta ulangan.
- Bir xil **8 ta ommaviy Google FLEURS o‘zbekcha audio**, jami 66,12 soniya: WER **115,70% → 20,66%**, CER **43,70% → 7,99%**. To‘rtta nutqsiz nazorat bo‘sh natija bergan.

Bu kichik sinov to‘plami. Shovqinli nutq, ismlar va username’larda xatolar qoladi.
Haqiqiy mikrofon/xona, MSI o‘rnatish va toza VM sinovi hali bajarilmagan.

O‘rnatish uchun **INSTALL-UZ.md**, ovoz uchun **VOICE-UZ.md**, tekshiruv uchun
**VERIFICATION-0.6.2-UZ.md** va **VOICE-UZ-BENCHMARK.md/json**’ni o‘qing.
Yuklamalar **SHA256SUMS.txt** bilan tekshiriladi:

```powershell
Get-FileHash .\Coucou-Windows-0.6.2-setup.exe -Algorithm SHA256
```

Manbadan yig‘ish: repository README va `windows/scripts/RUNTIME-BOOTSTRAP.md`.
Source checkout katta model/runtime binary’larini Git’dan olmaydi; helper relizdagi
ZIP hajmi, arxiv va har bir fayl xeshini tekshiradi, so‘ng joriy xizmat manbasini joylaydi.

## Litsenziyalar

Asl manba: [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou), muallif Louis Raillé.
Kod MIT; Coucou/Mochi nomi va media alohida `LICENSE-ASSETS.md` shartlariga ega.
NavAI model Apache-2.0, Whisper/whisper.cpp va Silero MIT, eSpeak NG GPLv3.
Ularning litsenziyalari va eSpeak tegishli manba arxivi runtime ichida mavjud.
