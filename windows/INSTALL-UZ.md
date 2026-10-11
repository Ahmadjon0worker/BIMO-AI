# Qanot AI + LocalAI Studio 0.6.3 — Windows x64

## O‘rnatish va ochish

`release/QanotAI-Windows-0.6.3-setup.exe` faylini ishga tushiring. Installer joriy Windows foydalanuvchisi uchun Qanot AI paneli, LocalAI Studio, Telegram va Windows vositalari hamda Python xizmatini birga o‘rnatadi. Node.js, Rust va Python’ni alohida o‘rnatish kerak emas. Microsoft WebView2 kompyuterda bo‘lmasa, installer uni internet orqali o‘rnatadi.

Yangi o‘rnatishda Studio ochiladi. Keyinchalik Start menyusidagi **Qanot AI LocalAI Studio** yorlig‘i, Qanot AI tray menyusi yoki panelning Local AI bo‘limidagi **LocalAI Studio** tugmasidan foydalaning. `coucou.exe --studio` ham Studio oynasini ochadi. Studio’ni yopish uni yashiradi; tray menyusidagi **Chiqish** ilova va unga tegishli mahalliy xizmatni to‘xtatadi.

Mahalliy xizmat Qanot AI ochilganda ishga tushadi. Studio → **Tizim holati** orqali ulanishni tekshiring; zarur bo‘lsa **Mahalliy xizmatlarni ishga tushirish** tugmasini bosing. Xizmat faqat shu kompyuterdagi `127.0.0.1:11435` yoki `127.0.0.1:11437` manzilida ishlaydi. Yangi Telegram imkoniyatlarini qo‘llaydigan xizmatdan foydalaniladi. 11435 portini eski xizmat band qilgan bo‘lsa, u saqlanadi va yangi xizmat 11437 portida ochiladi. Ikkala port band bo‘lsa, ilova sababini ko‘rsatadi. Windows’da bo‘sh portni aniqlash TCP ulanishining sekin rad etilishiga bog‘liq emas; 0.6.2 shu boshlash xatosini tuzatadi.

## Ollama, Gemini va Groq

Yangi o‘rnatishda **Avtomatik** provider tanlanadi. So‘rovda avval mahalliy Ollama tekshiriladi, keyin kaliti kiritilgan Gemini, so‘ng Groq ishlatiladi. Javob ostida uni yaratgan haqiqiy provider va model ko‘rsatiladi. Javob oqimi boshlanganidan keyin boshqa providerga o‘tib, matnlar aralashtirilmaydi. Telegram yuborish va kompyuter amallari fallback sabab qayta bajarilmaydi.

- **Ollama:** [rasmiy Ollama](https://ollama.com/) o‘rnatilgan va kamida bitta chat modeli mavjud bo‘lishi kerak. Installer Ollama chat modeli fayllarini yuklamaydi. Mahalliy ovoz uchun o‘zbekcha NavAI Whisper va ruscha/inglizcha small-q5_1 modellari paket ichida. Ollama ishlatilganda internet talab qilinmaydi.
- **Gemini:** [Google AI Studio](https://aistudio.google.com/apikey) orqali API kalitini oling.
- **Groq:** [Groq Console](https://console.groq.com/keys) orqali API kalitini oling.

Studio → **API kalitlari va sozlamalar** → **Chat provayderlari** bo‘limidagi Gemini yoki Groq qatori → kalitni kiriting → **Saqlash va tekshirish**. Yuqoridagi **AI provayderi** tanlovi provider va modelni tanlash uchun. Kalitni chatga yozmang. Kalitlar Windows Credential Manager’da saqlanadi; installerga kiritilmaydi. Model ro‘yxatini yangilash, mavjud modelni tanlash yoki model ID’ni qo‘lda kiritish mumkin. Avvalgi saqlangan provider, til va model tanlovlari saqlanadi.

Gemini yoki Groq ishlatilganda suhbat matni tegishli providerga yuboriladi; internet va ishlaydigan API kaliti kerak. Ularning kvotasi va to‘lovi provider hisobiga bog‘liq. Ulanishni tekshirish model ro‘yxatini tekshiradi; haqiqiy javobni tekshirish uchun qisqa savol yuboring.

API manbalari: [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai), [Groq OpenAI compatibility](https://console.groq.com/docs/openai), [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility).

## Ovoz va yangi panel qulayliklari

Studio’da **🎙 Ovozli boshqaruv** tugmasini bosing yoki Telegram va Windows vositalari → **Ovoz** bo‘limini oching.
**Gapirish**ni bosing; o‘zbekcha, ruscha yoki inglizcha nutq shu kompyuterda Whisper orqali taniladi.
O‘zbekcha uchun maxsus NavAI Whisper modeli va Silero nutq filtri avtomatik tanlanadi.
Oldingi 0.6.2 sinovida bir xil sakkizta ommaviy audio namunasida so‘z xatosi 115,70% dan 20,66% ga kamaydi;
bu kichik sinov to‘plamining natijasi. Shovqinli nutq, ismlar va username xato tanilishi mumkin.
Eshitilgan matnni tahrirlang; xabarni avval ko‘rish uchun «darhol yuborish»ni o‘chiring.
«Panelni och», «Sozlamalarni och», «Shu chatga salom yubor», «GitHub holatini ko‘rsat» buyruqlari mavjud vositalarga ulanadi.
Telegram qabul qiluvchisini oldindan tanlang. Aniq yuborish buyrug‘i darhol yuboriladi; xabarni ko‘rib yuborish ham tanlanadi.
O‘zbekcha javobni eshitish uchun eSpeak ovozini yoqing; u ham installer ichida. Buning uchun Ollama/Gemini/Groq kaliti shart emas.
Ixtiyoriy davomli tinglash «OK Qanot» bilan boshlanadi; mikrofon foydalanuvchi tugmani bosgandagina ochiladi.
Mikrofon ruxsatlari va barcha namunalar: `localai-service/VOICE-UZ.md`.

General sozlamalarida **kursor bilan ochish**ni yoqing. Panel ustiga kursor kelsa ochiladi, chiqqach 0,6 soniyada yig‘iladi;
drag va qo‘lda ixcham qilish tugmasi saqlanadi. Aktiv pill rangini palette orqali o‘zgartirish/reset qilish mumkin.
Maxsus notification ovozlari uchun sozlamadan Sounds papkasini oching, faylni joylang, **Reload** bosing.
GitHub’da Ctrl+↑/↓ tanlash, Ctrl+O ochish, Ctrl+E diff; Ctrl+Alt+D desktop Qanot’ni olib chiqish/qaytarish.
Tepa/past gorizontal, yonlar vertikal, burchaklar kvadrat va erkin joylashuv saqlanadi.

## Telegram va Windows vositalari

Studio → **Telegram va Windows vositalari** → **Shaxsiy Telegram**. Telegram App API ID va API hash’ni saqlang, telefon raqamini davlat kodi bilan kiriting, keyin kelgan kodni va kerak bo‘lsa 2FA parolini shu oynada tasdiqlang. Kirish kodi va parolni chatga yubormang. Bot uchun alohida **Bot va Windows** bo‘limi mavjud.

Shaxsiy akkaunt ulanganidan keyin chatlar oynasidan foydalaning:

- Chatlarni nomi bo‘yicha qidiring, o‘qilmaganlar, shaxsiy chatlar, guruhlar yoki kanallarni ajrating. **Yana yuklash** keyingi chatlarni ochadi.
- **Saved Messages** yoki `@username` orqali chatni to‘g‘ridan-to‘g‘ri oching. Username birinchi yuklangan chatlar orasida bo‘lishi shart emas.
- Chat tarixini oching, eski xabarlarni yuklang va matn ichidan qidiring. Rasm, fayl va ovozli xabar turi ko‘rsatiladi; ushbu versiyada ular yuklab olinmaydi.
- Pastdagi maydonda xabar yozing, kerak bo‘lsa xabardagi **Reply** tugmasini bosing. **Yuborish** yoki **Ctrl+Enter** darhol yuboradi; Enter yangi qator ochadi.
- AI yordamchisida javob tayyorlang, matnni tahrirlang yoki aniq **AI va yuborish** amalini tanlang. Qisqa javob, tarjima va suhbat xulosasi ham mavjud. Xulosa o‘zicha chatga yuborilmaydi.

Studio yoki Qanot AI chatida `@username ga salom yubor` kabi aniq buyruq xabarni darhol yuboradi. Avval ko‘rmoqchi bo‘lsangiz, qoralama so‘rang. Tanlangan Telegram chatiga `shunga shuni yubor` kabi buyruq berish ham mumkin. Qaysi odam yoki chat ekanligi noaniq buyruqda ilova tanlashni so‘raydi. Javob kelmay qolgan yuborishda natija noma’lum deb ko‘rsatiladi; aynan shu matnni qayta yuborish bloklanadi. Telegram chatini tekshirib, **Telegramni tekshirdim** tugmasini bosing. Bu tugma hech narsa yubormaydi; keyingi yuborish alohida buyruq yoki tugmani talab qiladi.

Telegram kirishi har bir Windows foydalanuvchisi uchun alohida saqlanadi. Eski `D:\LocalAI` xizmatidagi sessiya yangi xizmatga avtomatik ko‘chirilmaydi; bunday holatda shu oynada yana kiring. AI uchun faqat siz ochgan chatning cheklangan tarixi va berilgan ko‘rsatma ishlatiladi; fon rejimida barcha chatlarga avtomatik javob yuborilmaydi.

**Terminal / GitHub** bo‘limida AI’siz CMD va PowerShell skriptlarini bajaring, GitHub repository, issue va PR bilan ishlang. Portable GitHub CLI installer ichida keladi; birinchi kirish uchun `bin\gh.exe auth login --hostname github.com` ishlating. **Desktop** bo‘limi tanlangan oynada kuzatish, click, matn va scroll beradi; sessiya 5 daqiqa yoki 100 amal. AI taklif tayyorlaydi, uni tekshirib bajarish mumkin. Avvalgi Notepad yordamchisi ham mavjud. CMD/PowerShell CLI va AI/MCP ulash misollari [vositalar qo‘llanmasida](localai-service/TOOLS-UZ.md).

## Fayllar va yangilash

Qanot AI yangi nom bilan ishlaydi; Qanot hamroh ko‘rinishi ham yangilangan. Yangi standart EXE papkasi `%LOCALAPPDATA%\Qanot AI`. Eski sozlamalar, panel joyi, provider tanlovi va Telegram sessiyasi saqlanishi uchun quyidagi Coucou ma’lumot yo‘llari, credential yozuvlari, `coucou.exe` va CLI/hook nomlari ataylab o‘zgartirilmagan. Ularni qo‘lda qayta nomlamang. «OK Coucou / Kuku» kabi eski uyg‘otish iboralari ham moslik uchun saqlanadi.

- Sozlamalar: `%APPDATA%\Coucou\settings.json`.
- Yangi xizmatning workspace, Telegram sessiyasi va ishchi fayllari: `%LOCALAPPDATA%\Coucou\LocalAI`.
- Ilova bilan kelgan Python va kutubxonalar: o‘rnatish papkasidagi `localai-service`.
- O‘chirish/yangilash foydalanuvchi sozlamalari va LocalAI ishchi fayllarini saqlaydi. Mavjud `D:\LocalAI` papkasiga tegmaydi. Eski xizmatdagi akkaunt fayllari yangi per-user xizmatga avtomatik ko‘chirilmaydi.
- Codex yoki Claude hooklarini ham olib tashlash kerak bo‘lsa, ilovani o‘chirishdan oldin Qanot AI sozlamalaridan ularni olib tashlang. Uninstaller ushbu agentlarning shaxsiy konfiguratsiyasini o‘zgartirmaydi.
- Installer va runtime fayllarining nazorat summalari: `release/SHA256SUMS.txt`, `release/release-manifest.json`, `localai-service/runtime-manifest.json`.

## Manbadan yig‘ish

Node.js 24, Python 3.12+, Rust MSVC va C++ Build Tools kerak. [Joriy README](../README.md#manba-kodi-va-yigish) hamda [runtime bootstrap](scripts/RUNTIME-BOOTSTRAP.md) tartibidan foydalaning. QanotAI-Windows-0.6.3-runtime.zip manbadan build uchun; oddiy o‘rnatishda alohida kerak emas.

`localai-service/README.md` bo‘yicha runtime’ni tayyorlang. `windows` ichida runtime tayyorlang, `npm ci`, `npm test`, `node scripts/build-hook.mjs`, `cargo test --workspace --locked`, so‘ng `npm run pack` bajaring. Installer versiyasi, platformasi va arxitekturasi tekshiriladi; eski yoki ilova binary’sidan oldin yig‘ilgan installer chiqarilmaydi. Tarqatishda shaxsiy API kalitlari, Telegram sessiyalari, mavjud konfiguratsiya, loglar va foydalanuvchining chat modellari fayllarini qo‘shmang. Tekshirilgan ommaviy Whisper modeli `public-voice` manifesti orqali paketga kiritiladi.


## Tekshiruv holati

Yuqoridagi ovoz sonlari oldingi 0.6.2 natijasidir. 0.6.3 build va installer tekshiruvlari relizda alohida qayd etiladi. Haqiqiy mikrofon/xona, MSI o‘rnatish va toza VM sinovi hali bajarilmagan. Eshitilgan matn, oluvchi va xabarni tekshirib yuboring.
