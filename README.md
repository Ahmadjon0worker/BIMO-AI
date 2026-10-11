# Coucou Uzbek Edition — Windows 0.6.2

O‘zbekcha interfeysli Windows yordamchisi: ko‘chiriladigan Coucou paneli, alohida **LocalAI Studio**, Telegram, terminal, GitHub, tanlangan oynani boshqarish va mahalliy ovozli buyruqlar.

Bu [Louis-CFM/coucou](https://github.com/Louis-CFM/coucou) loyihasining Windows uchun moslashtirilgan **forki**. Ushbu ombor va uning 0.6.2 installerlaridagi qo‘shimchalar upstream macOS/iPhone reliziga kiritilgan deb hisoblanmaydi.

## Yuklab olish

| Windows x64 paketi | Nima uchun |
|---|---|
| **[0.6.2 Setup EXE — taxminan 405 MiB](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/download/v0.6.2/Coucou-Windows-0.6.2-setup.exe)** | Tavsiya etiladi; joriy Windows foydalanuvchisi uchun o‘rnatadi. |
| [0.6.2 MSI — taxminan 436 MiB](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/download/v0.6.2/Coucou-Windows-0.6.2.msi) | MSI formatini talab qiladigan o‘rnatish jarayonlari uchun. |
| [v0.6.2 relizi va tekshiruv fayllari](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/tag/v0.6.2) | Nazorat summalari, runtime paketi va reliz dalillari. |

**Talablar:** Windows 10/11 **x64**, Microsoft Edge WebView2 va paketni o‘rnatish uchun yetarli disk joyi. WebView2 bo‘lmasa, installer uni internet orqali o‘rnatadi. Tayyor installer uchun Python, Node.js yoki Rust’ni alohida o‘rnatish kerak emas. ARM64 uchun alohida installer bu relizda yo‘q.

Paket ichida Python xizmati, Telegram/Windows vositalari, GitHub CLI, Whisper nutq modellari, Silero VAD va eSpeak NG mavjud. **Ollama dasturi va katta chat modellari paketga kiritilmagan.** Ularni mahalliy AI suhbat kerak bo‘lsa alohida tayyorlang.

## Birinchi ishga tushirish

1. Setup EXE’ni ishga tushiring va o‘rnatishni tugating. Yangi o‘rnatishda LocalAI Studio ochiladi.
2. Keyinchalik Start menyusidan **Coucou LocalAI Studio**, Coucou tray menyusi yoki panelning **LocalAI Studio** tugmasini tanlang. O‘rnatilgan `coucou.exe --studio` ham shu oynani ochadi.
3. Studio → **Tizim holati** orqali mahalliy xizmatni tekshiring. Ulanmasa, **Mahalliy xizmatlarni ishga tushirish** tugmasidan foydalaning.
4. AI suhbat uchun Ollama yoki cloud provider’ni sozlang. Oddiy Telegram, terminal va desktop amallari uchun chat modeli shart emas.
5. Tilni almashtirish: Sozlamalar → Umumiy → Til → **O‘zbekcha**.

Studio oynasini yopish uni yashiradi. Tray menyusidagi **Chiqish** Coucou va unga tegishli mahalliy xizmatni to‘xtatadi. Windows bilan avtomatik ochish umumiy sozlamalarda boshqariladi.

Xizmat faqat shu kompyuterdagi `127.0.0.1:11435` yoki `127.0.0.1:11437` da ishlaydi. 11435 portida eski yoki mos kelmaydigan xizmat bo‘lsa, unga tegilmaydi va yangi xizmat 11437 ni ishlatadi. Ikkala port ham band bo‘lsa, ilova sababini ko‘rsatadi. Mavjud `D:\LocalAI` o‘rnatmasi yangi installer uchun majburiy emas.

Batafsil: [o‘rnatish va sozlash](windows/INSTALL-UZ.md), [Windows imkoniyatlari](windows/README-UZ.md).

## Panel va agentlar holati

- **⠿** tutqichini ushlab panelni sudrang; mouse va touch qo‘llab-quvvatlanadi. Chetga qo‘yib yuborganda yuqori/pastda gorizontal, yonlarda vertikal, burchaklarda kvadrat shaklga moslashadi. Joylashuv qayta ochishda saqlanadi; Windows vazifalar paneli uchun ish maydoni hisobga olinadi.
- Sozlamalar → Umumiy → **Panelning joyi** orqali to‘qqiz joylashuvni tanlang. Tutqichni ikki marta bosish yoki **Yuqori markazga qaytarish** boshlang‘ich joyga qaytaradi.
- Kengaygan paneldagi **−** tugmasi uni ixchamlaydi. Kutayotgan ruxsat yoki savol bekor qilinmaydi.
- Kursor bilan ochish, avtomatik yopilish vaqti, pill ranglari, klaviatura yorliqlari va notification ovozlari sozlanadi. Maxsus ovozlar uchun Sounds papkasini oching, fayl qo‘ying va **Reload** bosing.
- Codex holati o‘ylash, ishlash, qidirish, ruxsat/javob kutish, tugash, xato va limitni ko‘rsatadi. Yakuniy javob mavjud bo‘lsa, tugash holati keyingi vazifagacha saqlanadi.

Codex hooklari `%USERPROFILE%\.codex\hooks.json` orqali ulanadi. Yangi hooklarni Codex’da `/hooks` yoki Hooks sozlamalari orqali bir marta tekshirib tasdiqlang. Relay ulanish sinovi haqiqiy agent sessiyasining barcha holatlari tekshirilganini anglatmaydi. Agent konfiguratsiyasini olib tashlash kerak bo‘lsa, Coucou’ni o‘chirishdan oldin uning sozlamalaridan hooklarni olib tashlang.

## Ollama, Gemini va Groq

**Avtomatik** rejim Ollama → sozlangan Gemini → sozlangan Groq tartibida provider tanlaydi. Javob ostida haqiqiy provider va model ko‘rsatiladi. Oqim boshlanganidan keyin boshqa provider matni shu javobga qo‘shilmaydi. Muayyan provider’ni tanlasangiz, faqat o‘sha provider ishlatiladi.

| Provider | Sozlash | Internet |
|---|---|---|
| [Ollama](https://ollama.com/) | Ollama’ni o‘rnating, chat modelini yuklang, xizmatni ishga tushiring; Studio’da modelni tanlang. Mahalliy loopback portlari 11434 va 11436 qo‘llab-quvvatlanadi. | Dastur/modelni olishda kerak; keyingi mahalliy javoblarda shart emas. |
| [Gemini](https://aistudio.google.com/apikey) | Google AI Studio’dan API kalitini oling va Studio’da saqlang. | Kerak. |
| [Groq](https://console.groq.com/keys) | Groq Console’dan API kalitini oling va Studio’da saqlang. | Kerak. |

Studio → **API kalitlari va sozlamalar** → **Chat provayderlari** → provider → **Saqlash va tekshirish**. Keyin **AI provayderi** va modelni tanlang. Model ro‘yxatini yangilash yoki model ID’ni qo‘lda kiritish mumkin. Ulanishni tekshirish model ro‘yxatini tekshiradi; haqiqiy javobni sinash uchun qisqa savol yuboring.

Kalitni chatga yozmang. Gemini/Groq kalitlari Windows Credential Manager’da saqlanadi. Cloud provider tanlansa, so‘rov matni o‘sha providerga yuboriladi; kvota va to‘lov uning hisobingizga bog‘liq. Mahalliy ovozni tanish uchun bu kalitlar kerak emas.

## Telegram: shaxsiy akkaunt va bot

Studio → **Telegram va Windows vositalari** → **Shaxsiy Telegram**. [Telegram App API](https://my.telegram.org/apps) orqali olingan API ID/hash’ni shu oynaga kiriting. Telefon raqami → kirish kodi → zarur bo‘lsa 2FA paroli bosqichlarini bajaring. Kod va parolni chatga yubormang. Bot ulash uchun alohida **Bot va Windows** bo‘limi bor.

Akkaunt ulanganidan keyin:

- Chatlarni qidiring, o‘qilmaganlar/shaxsiy chatlar/guruhlar/kanallar bo‘yicha filtrlang va keyingi sahifani yuklang.
- **Saved Messages** yoki `@username` orqali chatni oching. Tarixni yuklang, eski xabarlar va matn ichidan qidiring.
- Oddiy xabar yoki reply yozing. **Yuborish** va **Ctrl+Enter** darhol yuboradi; Enter yangi qator ochadi.
- AI qoralama, tarjima, qisqa javob yoki xulosa tayyorlaydi. Matnni tahrirlash mumkin. **AI va yuborish** yoki `@username ga salom yubor` kabi aniq yuborish buyrug‘i bir xabarni yuborishga ruxsat beradi.

**Qoralama/xulosa so‘rovi o‘zicha yubormaydi.** Aniq yuborish buyrug‘i esa darhol yuborishi mumkin. Ovozda avval ko‘rishni istasangiz, **darhol yuborish** belgisini o‘chiring. Oluvchi noaniq bo‘lsa, chatni tanlash so‘raladi; tanlovni almashtirish oldin tayyorlangan xabarning adresatini o‘zgartirmaydi.

Yuborish javobi kelmay qolsa, natija **noma’lum** deb ko‘rsatiladi va avtomatik takrorlanmaydi. Telegramni tekshirib, **Telegramni tekshirdim** tugmasini bosing; u hech narsa yubormaydi. Keyingi yuborish alohida buyruq yoki tugmani talab qiladi.

API ma’lumotlari va sessiya per-user Windows DPAPI bilan himoyalanadi. Eski `D:\LocalAI` sessiyasi yangi xizmatga avtomatik ko‘chirilmaydi. AI uchun faqat siz ochgan chatning cheklangan tarixi va ko‘rsatmangiz ishlatiladi; barcha chatlarni fonda o‘qib, avtomatik javob berish yoqilmagan. Rasm/fayl/ovozli xabar turi ko‘rsatiladi, ammo bu versiyada ular Telegram’dan yuklab olinmaydi.

## Windows vositalari va AI rejalar

**Terminal / GitHub** bo‘limida CMD yoki PowerShell skriptini yozib, **Bajarish**ni bosing. Exit code, stdout/stderr va timeout ko‘rsatiladi. Skript joriy foydalanuvchi huquqida ishlaydi; ish papkasining workspace ichida bo‘lishi OS sandbox yaratmaydi. AI skript taklif qiladi, bajarishdan oldin uni ko‘rib chiqing.

Portable rasmiy GitHub CLI installer ichida. Repository, issue va pull request bilan ishlash mavjud; issue/draft PR yaratish aniq amal orqali bajariladi. GitHub login foydalanuvchi tomonidan bajariladi.

**Desktop** bo‘limida oynani tanlang va **Kuzatish**ni bosing. Click, literal matn, navigatsiya yoki scroll joriy kuzatuv va oyna identifikatoriga bog‘lanadi. Sessiya 5 daqiqa yoki 100 amal bilan cheklanadi. Login/parol/to‘lov/UAC/shell oynalari ushbu paneldan boshqarilmaydi. Avvalgi, har bir amali tasdiqlanadigan Notepad hujjat yordamchisi ham saqlangan.

AI taklifi bajarilgan ish degani emas; natijani tekshiring. **Stop Local AI** faol desktop sessiyasi, terminal va ovoz ishlarini to‘xtatadi. Davom etish uchun profilni tanlab, yangi sessiya oching. OpenCode bu installerga kiritilmagan.

CLI va MCP ulash misollari: [vositalar qo‘llanmasi](windows/localai-service/TOOLS-UZ.md).

## O‘zbekcha ovoz — mahalliy ishlaydi

Studio → **🎙 Ovozli boshqaruv** yoki Telegram va Windows vositalari → **Ovoz** → **Gapirish**. Mikrofon ilova ochilganda avtomatik yoqilmaydi. Bo‘limdan chiqish, oynani yashirish, ovozni to‘xtatish yoki Stop mikrofon treklarini yopadi. Windows/WebView2 mikrofon ruxsatini berish kerak bo‘lishi mumkin.

- O‘zbekcha: **NavAI Whisper small Q5_1 + Silero VAD 6.2.0**.
- Ruscha/inglizcha: multilingual **small-q5_1**.
- Mahalliy javob ovozi: **eSpeak NG**; uning ovozi robotga o‘xshaydi.
- Modellar installer ichida. Nutqni tanish va eSpeak uchun internet, Ollama yoki cloud API kaliti shart emas.
- Yozuv eng ko‘pi 15 soniya; bir vaqtda bitta transkripsiya. Vaqtinchalik WAV va decoder natijalari ish tugagach o‘chiriladi.

Misollar: «Panelni och», «Sozlamalarni och», «Studioni och», «GitHub holatini ko‘rsat», «Shu chatga salom yubor». Telegram uchun avval oluvchini tanlang. Murakkab AI reja sozlangan chat provider’ni ishlatadi; terminal buyrug‘i muharrirda ko‘rib chiqiladi. Ixtiyoriy davomli tinglashni o‘zingiz yoqasiz; unda «OK Coucou / Kuku» bilan boshlangan buyruqlar qabul qilinadi.

**Tekshirilgan natija va cheklov:** bir xil **8 ta Google FLEURS o‘zbekcha audio** (jami 66,12 soniya) uchun WER **115,70% → 20,66%**, CER **43,70% → 7,99%** bo‘ldi. WER qo‘shimcha so‘zlar sabab 100% dan oshishi mumkin. Bu kichik, tasodifiy bo‘lmagan sinov to‘plami; barcha odamlar yoki mikrofonlar uchun aniqlik bahosi emas. Shovqinli nutq, ismlar va username xato tanilishi mumkin. **Haqiqiy mikrofon/xona sinovi hali bajarilmagan**; o‘rnatilgan xizmat ommaviy audio va sun’iy nazoratlar bilan tekshirilgan. Eshitilgan matnni yuborishdan avval tekshiring.

[Ovoz qo‘llanmasi](windows/localai-service/VOICE-UZ.md) · [O‘lchash usuli va har bir namuna](windows/localai-service/VOICE-UZ-BENCHMARK.md) · [JSON natijalar](windows/localai-service/VOICE-UZ-BENCHMARK.json)

## Saqlash, yangilash va maxfiylik

| Joy | Nima saqlanadi |
|---|---|
| `%LOCALAPPDATA%\Coucou` | Standart per-user EXE o‘rnatish joyi; ilova va portable runtime. |
| `%APPDATA%\Coucou\settings.json` | Til, provider/model tanlovi, panel va boshqa sozlamalar. |
| `%APPDATA%\Coucou\sounds` | Foydalanuvchi notification ovozlari. |
| `%LOCALAPPDATA%\Coucou\LocalAI` | Workspace, ishchi fayllar, DPAPI bilan himoyalangan Telegram ma’lumotlari/sessiyasi. |
| Windows Credential Manager | AI provider kalitlari. |

Yangi installer mavjud o‘rnatishni yangilaydi. Foydalanuvchi sozlamalari va LocalAI ishchi fayllari yangilash/o‘chirishda saqlanadi; mavjud `D:\LocalAI` ga tegilmaydi. Akkaunt va sozlamalar per-user: boshqa Windows foydalanuvchisiga nusxa ko‘chirish avtomatik login bermaydi.

Chat, screenshot va terminal chiqishi AI uchun ma’lumotdir; ularning ichidagi buyruqlar avtomatik ijro etilmaydi. Cloud AI ishlatilsa, tegishli vazifa/chat matni providerga boradi; Telegram yuborishda matn Telegram API’ga boradi. Ovoz yozuvi va transkript alohida jurnalga saqlanmaydi. Kalitlar, Telegram sessiyalari va shaxsiy konfiguratsiya ommaviy installerga kiritilmaydi.

Yuklangan installer’ni relizdagi `SHA256SUMS.txt` bilan solishtirish mumkin:

```powershell
Get-FileHash .\Coucou-Windows-0.6.2-setup.exe -Algorithm SHA256
```

## Tekshiruv doirasi

0.6.2 uchun frontend **633/633** test, ovoz/HTTP router **50** test, TypeScript va production Vite/Rust build o‘tgan. NSIS va MSI ichidan ilova, hook, qo‘llanma va **2068 runtime fayli** chiqarilib, SHA-256/versiya/platforma tekshirilgan. EXE shu Windows kompyuterga o‘rnatilib, eski sozlamalar va shifrlangan Telegram fayli saqlangani tekshirilgan; o‘rnatilgan ASR haqiqiy decoder bilan ishlagan.

**MSI o‘rnatish va toza VM sinovi bajarilmagan.** Ovoz unit suite’dagi bitta ixtiyoriy native smoke o‘tkazib yuborilgan; native ASR alohida audio sinovida tekshirilgan. Bu dalillar real mikrofon, barcha Windows qurilmalari yoki AI’ning har bir erkin vazifasi uchun kafolat emas. Tekshiruv hisobotlari [v0.6.2 relizida](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/tag/v0.6.2) beriladi.

## Manba kodi va yig‘ish

```text
windows/
  src/                   TypeScript panel, Studio, Telegram/vositalar, tarjimalar
  src-tauri/             Rust/Tauri, Windows bridge, installer sozlamalari
  hook/                  coucou-hook relay
  localai-service/src/   Python service, Telegram, desktop, terminal, ovoz
  localai-service/tests/ Python testlar
  scripts/               Runtime tayyorlash, build va installer tekshiruvi
  tests/                 Frontend testlar
NotchBuddy/              Asl macOS/iPhone kodi va umumiy ovoz resurslari
docs/, relay/            Upstream hujjatlar va iPhone relay manbasi
```

Windows x64 build kompyuterida **Node.js 24** (testlar uchun kamida 22.18), Rust MSVC toolchain, Microsoft C++ Build Tools (**Desktop development with C++**) va runtime paketini tayyorlash uchun **Python 3.12** kerak. Installer tekshiruvi uchun **7-Zip** va Tauri’ning WiX `dark.exe` keshi ishlatiladi. Bular tayyor ilovani o‘rnatadigan foydalanuvchiga kerak emas.

Git klonining o‘zi katta portable Python/model binary’larini bermaydi: ular source asset sifatida emas, [v0.6.2 runtime ZIP](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/releases/download/v0.6.2/Coucou-Windows-0.6.2-runtime.zip) orqali tarqatiladi. Ikonalar, Canvas personaj kodi va umumiy notification ovozlari omborda bor; ular uchun alohida «yo‘qolgan asset» yuklash shart emas.

PowerShell’da:

```powershell
git clone https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-.git
cd CouCou-Uzbek-edition-\windows
python scripts/prepare-release-runtime.py --download
npm ci
npm test
node scripts/build-hook.mjs
cargo test --workspace --locked
npm run pack
```

`prepare-release-runtime.py` faqat build vaqtida aniq v0.6.2 public runtime ZIP’ni yuklaydi; hajm, SHA-256, manifest va har bir faylni tekshiradi. So‘ng portable runtime, ovoz modellari, GitHub CLI va private Microsoft DLL’larini build uchun joylaydi hamda `build_runtime.py --sync-source` orqali **joriy Python manbasiga** moslaydi. Ilova ishga tushishda runtime/model yuklamaydi; helper installer’ni ishga tushirmaydi yoki shaxsiy konfiguratsiyani nusxalamaydi.

ZIP’ni oldindan olgan bo‘lsangiz, tarmoqsiz tayyorlash uchun yuklash buyrug‘i o‘rniga:

```powershell
python scripts/prepare-release-runtime.py --archive C:\path\Coucou-Windows-0.6.2-runtime.zip
```

Xizmatni ishga tushirmasdan runtime self-test:

```powershell
.\localai-service\bundle\runtime\python.exe -B .\localai-service\bundle\src\service_main.py --self-test
```

`npm run pack` TypeScript/Vite va Tauri production build’ni bajaradi, hook/runtime’ni tekshiradi va EXE/MSI’ni `windows/release` ichiga yozadi. `release-manifest.json` va `SHA256SUMS.txt` ham yaratiladi. Eski installer yoki manba kodiga mos kelmaydigan runtime xeshlari bilan paket chiqarilmaydi.

Development: tayyorlangan runtime bilan `npm run tauri dev`. Faqat UI’ni tekshirish uchun `npm run build` mavjud; native xizmat va vositalar Tauri bridge orqali ishlaydi. Runtime’ni noldan tayyorlash: [runtime qo‘llanmasi](windows/localai-service/README.md). O‘zbek modelini qayta konvertatsiya/kvantlash: [model tayyorlash](windows/localai-service/model-preparation/README.md).

## Litsenziya va asl loyiha

Asl Coucou muallifi — **[Louis Raillé](https://louisraille.fr)**. Manba kodi [MIT litsenziyasi](LICENSE) ostida. Ushbu Windows forkiga upstream muallifi tomonidan homiylik yoki tasdiq berilgani da’vo qilinmaydi.

**Nom va media alohida:** «Coucou», «Mochi», personaj, ikonalar, notification ovozlari va demo media MIT bilan litsenziyalanmagan. [LICENSE-ASSETS.md](LICENSE-ASSETS.md) ularni Louis Raillé mulki deb belgilaydi va shu nom/assetlar bilan ommaviy fork tarqatish uchun yozma ruxsat talab qiladi. Kodni qayta ishlatish ruxsati bu assetlarni ommaviy tarqatish ruxsatini bermaydi.

Whisper/whisper.cpp va Silero MIT, NavAI o‘zbekcha model Apache-2.0, eSpeak NG GPLv3 litsenziyasida. Ularning license/provenance fayllari runtime paketida, eSpeak tegishli manba arxivi ham tarqatiladi. [Ovoz manbalari va litsenziyalari](windows/localai-service/VOICE-UZ.md#litsenziyalar-va-manbalar).

Asl loyiha: [GitHub](https://github.com/Louis-CFM/coucou) · [sayt](https://louis-cfm.github.io/coucou/) · [upstream maxfiylik](https://louis-cfm.github.io/coucou/privacy.html) · [upstream shartlar](https://louis-cfm.github.io/coucou/terms.html) · [upstream yordam](https://louis-cfm.github.io/coucou/support.html). Bu havolalar original loyihaga tegishli; Windows forkiga oid savol va xatolarni [ushbu ombor issues](https://github.com/Ahmadjon0worker/CouCou-Uzbek-edition-/issues) orqali yuboring, shaxsiy kalit/kod/xabarlarni qo‘shmang.
