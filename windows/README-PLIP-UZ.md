# BIMO AI 0.7.1 — Moshi yordamchisi

0.7.1 Plip’ning ovozli suhbat, ko‘rsatgich, AI ulanish holati va boshqariladigan xotira usullarini Windows uchun moslashtiradi. Mavjud **liquid Moshi**, panel joylashuvlari, **LocalAI Studio**, Telegram akkaunti va bot, CMD/PowerShell, GitHub va o‘zbekcha mahalliy ovoz saqlanadi.

Ushbu imkoniyatlar **BIMO AI 0.7.1** GitHub reliziga kiritilgan. Yig‘ish natijasi `release/BIMOAI-Windows-0.7.1-setup.exe` va `release/BIMOAI-Windows-0.7.1.msi` bo‘ladi. [GitHub Release](https://github.com/Ahmadjon0worker/BIMO-AI/releases/tag/v0.7.1) orqali yuklab oling.

## Qayerdan ochiladi

Start yoki tray menyusidan **BIMO AI LocalAI Studio**ni oching. Studio → **Telegram va Windows vositalari** orqali quyidagi bo‘limlardan foydalaning:

| Bo‘lim | Nima qilish mumkin |
|---|---|
| **Moshi AI va xotira** | AI ulanish holatini ko‘rish, savol berish, afzallikni eslab qolish yoki unutish, amallar tarixini ko‘rish. |
| **Desktop** | Oynani tanlash, haqiqiy tugma/maydonni topish, Moshi bilan ko‘rsatish, bitta amalni bajarish va kutilgan natijani tekshirish. |
| **Ovoz** | Tugmani ushlab gapirish, o‘zbekcha nutqni tanish, mavjud buyruqlarni bajarish va javobni mahalliy ovozda eshitish. |
| **Shaxsiy Telegram** | Mavjud chatlar, tarix, qidiruv, xabar/reply va AI yordamidagi yuborish. |

Mahalliy xizmat ishlamayotgan bo‘lsa, Studio’dagi **Mahalliy xizmatlarni ishga tushirish** tugmasini bosing. Ilova faqat shu Windows kompyuteridagi 11435 yoki 11437 loopback portini ishlatadi.

## Ovoz: ushlab gapiring, qo‘yib yuboring

1. **Ovoz** bo‘limini oching, nutq tilini **O‘zbekcha** qiling va ovoz holatini tekshiring.
2. **Bosib gapiring** tugmasini yoki **Ctrl+Shift+Space** yorlig‘ini ushlab turing.
3. Masalan, «Panelni och» yoki «Studioni och» deb ayting. Ovoz balandligi va yozuv davomiyligi ko‘rinadi.
4. Tugmani qo‘yib yuboring. Yozuv yakunlanadi, so‘ng Whisper uni mahalliy taniydi. **Eshitilgan buyruq** matnini tahrirlash ham mumkin.

Yorliqni **Sozlamalar → Klaviatura yorliqlari / Shortcuts** bo‘limidan o‘zgartirish yoki o‘chirish mumkin. Birinchi mikrofon ruxsati kutilayotganida tugmani qo‘yib yuborsangiz, yozuv boshlanmaydi; ruxsatni bergach yana ushlab gapiring.

**Gapirish** tugmasi alohida rejim: gapdan keyingi taxminan bir soniya sukut yozuvni yakunlaydi. **Ushlab gapirish** rejimida sukut uni yakunlamaydi; qo‘yib yuborish yoki **Gapirdim** tugmasi yakunlaydi. Har ikkala rejim eng ko‘pi **15 soniya** yozadi. Mikrofon ilova ochilganda o‘zicha yoqilmaydi; bo‘limdan chiqish, oynani yashirish yoki Stop treklarni yopadi.

Nutq butun qisqa yozuv tugagach taniladi; bu jonli so‘zma-so‘z transkripsiya emas. O‘zbekcha **NavAI Whisper small Q5_1 + Silero VAD**, ruscha/inglizcha multilingual **small-q5_1** ishlatiladi. Modellar paketda bor, nutqni tanish uchun chat modeli yoki internet kerak emas.

**Javobni mahalliy ovozda o‘qish**ni yoqsangiz, eSpeak NG javobni jumlalab o‘qiydi. Bir jumla o‘qilayotganda keyingisi tayyorlanadi; kod bloklari ovozda o‘qilmaydi. AI matnli javobi olingach ovoz navbati boshlanadi. Yana gapirishni boshlash oldingi javob ovozi va kutayotgan AI javobini bekor qiladi. Bekor qilingan so‘rovning kechikkan javobi qayta o‘qilmaydi.

Masalan: «Telegramni och», «GitHub holatini ko‘rsat», «Shu chatga salom yubor». CMD/PowerShell ko‘rsatmasi muharrirga tayyorlanadi va mavjud bajarish tugmasi bilan ishga tushiriladi. Oddiy savol sozlangan AI providerga yuboriladi. Ism yoki username xato tanilishi mumkin; qabul qiluvchi va eshitilgan matnni tekshirish imkoniyati saqlangan.

## Moshi AI, ulanish holati va xotira

**Moshi AI va xotira** bo‘limida **Holatni yangilash**ni bosing. Codex/Claude kartalari CLI o‘rnatilganini, kirish holatini va ajratilgan matn rejimi bilan mosligini tekshiradi. Ilova CLI’ni avtomatik o‘rnatmaydi yoki akkauntga kirmaydi. Mos kelmaydigan versiya foydalanishga tayyor deb ko‘rsatilmaydi.

**Avtomatik** va **Ollama / Gemini / Groq** tanlovi mavjud broker sozlamalarini ishlatadi: Auto **Ollama → sozlangan Gemini → sozlangan Groq** tartibini saqlaydi. Broker kartasida model tayyorligi **so‘rovda tekshiriladi**; sozlangan provider hali muvaffaqiyatli javob degani emas. **Codex CLI** yoki **Claude Code CLI** shu bo‘limdagi tanlovda alohida tanlanadi. Mavjud Studio va Telegram provider sozlamalari o‘zgarmaydi.

Bu bo‘limdagi AI javobi **faqat matn**: Telegram xabari yubormaydi, terminal ishlatmaydi va desktop tugmasini bosmaydi. Mos CLI config/vositalardan ajratilgan holda ishlaydi; Codex read-only va ephemeral rejimida chaqiriladi. CLI vosita chaqirishga urinsa yoki javobi yaroqsiz bo‘lsa, so‘rov to‘xtatiladi. **Javobni to‘xtatish** tugmasi kutayotgan javobni bekor qiladi; avtomatik qayta yuborish yo‘q.

Xotiraga, masalan, «Javoblarni o‘zbekcha va qisqa yozing» deb yozib **Eslab qolish**ni bosing. Har yozuvda manba va yaratilgan vaqt saqlanadi. **Unutish** tanlangan yozuvni o‘chiradi. Ko‘pi bilan 80 ta, har biri 500 belgigacha afzallik saqlanadi.

Xotira shu Windows foydalanuvchisiga bog‘langan **DPAPI** bilan shifrlanadi. Kontaktlar, brauzer autofill ma’lumotlari, boshqa assistant xotirasi yoki Telegram xabarlari avtomatik import qilinmaydi. Parol, kirish/tasdiqlash kodi, API kalit, token va maxfiy ID atamalarini aniqlash tekshiruvi mavjud; maxfiy ma’lumotlarni xotiraga kiritmang. So‘rovda faqat o‘zingiz saqlagan afzalliklar ma’lumot sifatida beriladi. Cloud provider yoki CLI tanlansa, savol va shu afzalliklar tegishli AI xizmatiga boradi.

**Amallar tarixi** eng so‘nggi 100 ta chaqiruvning qisqa ma’lumotini saqlaydi: vosita nomi, bajarilgan/xato/bekor qilingan/noma’lum holat va davomiylik. Xabar matni, terminal skripti, javob tanasi, screenshot yoki API kalit jurnalga yozilmaydi. Bu tarix `/tools/call` orqali bajarilgan desktop, terminal, GitHub va assistant chaqiruvlari uchun; Telegram yuborish oqimi o‘zining mavjud natija hisobini saqlaydi. Jurnal buzilgan bo‘lsa, ma’lum amal natijasi yashirilmaydi va amal qayta bajarilmaydi.

## Haqiqiy tugmani topish va Moshi bilan ko‘rsatish

1. **Desktop** bo‘limida ochiq oynalar ro‘yxatini yangilang, kerakli oynani tanlab sessiyani boshlang.
2. Oynani yangidan kuzating. **Moshi bilan aniq boshqarish** qismida tugma yoki maydon nomini qidiring. Lotin/kirill qidiruvi qo‘llab-quvvatlanadi.
3. Haqiqiy Windows UIA elementini ro‘yxatdan tanlang va **Moshi bilan ko‘rsat**ni bosing.
4. Liquid Moshi ko‘rsatgichi element yoniga yumshoq uchadi, nomini ko‘rsatadi va qaytib yashirinadi. U sichqoncha/klaviatura amalini bajarmaydi; ko‘rsatgich orqali sichqoncha bosishlari ostidagi oynaga o‘tadi.
5. Kerakli amalni tanlang va **Tanlangan elementda bajarish**ni bosing. Bu bitta aniq click, maydonga literal matn yoki scroll amalini bajaradi. Keyingi amal uchun oynani yana kuzating.

Oyna egasi, geometriya va kuzatilgan element identifikatori qayta tekshiriladi. Oyna ko‘chgan, yopilgan, boshqa oyna bilan yopilgan yoki element o‘zgargan bo‘lsa, eski kuzatuv asosida amal bajarilmaydi. Faqat ko‘rinadigan, faol UIA elementlari ishlatiladi; UIA ma’lumoti bermaydigan ilovalarda nom bo‘yicha topish cheklangan bo‘lishi mumkin. Login/parol/to‘lov/UAC/shell oynalariga mavjud himoya chegaralari saqlangan.

**Kutilgan aniq matn** maydoniga, masalan, `Saqlandi` yozsangiz, amaldan keyingi yangi UIA kuzatuvida shu matn borligi tekshiriladi. Moshi biror joyni ko‘rsatgani yoki ekran pikseli o‘zgargani vazifa tugaganini tasdiqlamaydi. Natija ko‘rsatilmagan yoki yangi kuzatuv olinmagan bo‘lsa, yakun tekshirilmagan deb ko‘rsatiladi. Bu tekshiruv UIA matnida berilgan satrni topadi; faylning diskka yozilganini alohida shart bo‘lmasa isbotlamaydi.

## Bosqichma-bosqich yordam

**Vazifa qadamlari**ga har qatorda `qadam nomi | kutilgan aniq matn` formatini kiriting. Masalan:

```text
Bosh sahifani ochish | Bosh sahifa
Natijani tekshirish | Saqlandi
```

**Qadamlarni tayyorlash** ro‘yxat yaratadi; ko‘pi bilan 12 qadam. **Joriy qadamni tekshirish** oynani yangidan kuzatadi va berilgan matnni UIA ma’lumotida qidiradi. Tasdiqlangan qadamdan keyin **Keyingi qadam**ni o‘zingiz bosing. Ro‘yxat tugmalarni o‘zicha bosmaydi va tasodifiy ekran o‘zgarishini muvaffaqiyat deb qabul qilmaydi. **Desktop AI** hali qadamlar taklif qiladi; har bir amalni foydalanuvchi bajarish tugmasi bilan boshlaydi.

## Telegram va liquid panel mosligi

Shaxsiy Telegram kirishi, chat qidiruvi, tarix, literal xabar/reply, AI qoralama va **aniq buyruq bilan darhol yuborish** saqlanadi. `@username ga salom yubor` kabi aniq yuborish buyrug‘i bitta xabarga ruxsat beradi. Oldin ko‘rish kerak bo‘lsa, ovoz bo‘limidagi darhol yuborish belgisini o‘chiring. Natija noma’lum bo‘lsa, avtomatik takrorlanmaydi. Barcha chatlarni fonda o‘qish yoki o‘zicha javob berish qo‘shilmagan.

Mavjud beshburchak Moshi, agent ranglari, Thinking Orbs va QuickLiquid yuzalari saqlangan. Panel chet/burchak joylashuvi va ixchamlash tugmasi ishlaydi. Hover yoqilganida kursor panel ustida taxminan **400 ms** turgach kengayadi; shunchaki kesib o‘tish uni darhol ochmaydi. Windows’da **reduced motion** yoqilsa, ko‘rsatgich uchish animatsiyasi o‘rniga darhol joylashadi, material harakati kamayadi.

Glass effekti WebView ichidagi kontentni sindirib ko‘rsatadi. Tashqi Windows desktop uchun shaffoflik bor; bu butun desktop tasvirining DWM blur/refraction effekti emas. Telegram DPAPI sessiyasi, Windows Credential Manager kalitlari va mavjud `%APPDATA%\Coucou` / `%LOCALAPPDATA%\Coucou\LocalAI` ma’lumot yo‘llari saqlanadi.

## Tekshiruv va manbalar

Yakuniy Python regression: **233 test**, **1 ixtiyoriy public-asset native voice smoke skip**, qolganlari o‘tdi. Sinov bundled Python bilan bajarildi; log mahalliy task papkasidagi `tmp/plip-070-final-python.log`da. Skip haqiqiy mikrofon sinovi emas: ommaviy/sun’iy audio smoke testi alohida yoqiladi. Odam ovozi va xona/mikrofon sinovi foydalanuvchi qaytganda bajariladi.

Haqiqiy ajratilgan Codex adapteri «Faqat Salom deb javob ber» so‘roviga **Salom** qaytardi: birinchi matn taxminan 5.7 s, umumiy 7.2 s. Bu sinovga ekran, shaxsiy fayl yoki Telegram chat matni berilmadi. Frontend/native build, installer chiqarish va o‘rnatilgan ilova tekshiruvi alohida reliz dalilida qayd qilinadi.

[Plip OSS](https://github.com/hussainn7/plip-oss/tree/b53949745126141b3133710f71e8380b3cdd2e58) — MIT © 2026 Hussain. Moshi parvoz matematikasi Plip’dan moslashtirilgan; litsenziya va mualliflik yozuvi saqlanadi. Python assistant qatlami shu arxitektura g‘oyalari asosida Windows uchun alohida yozilgan. macOS AppKit/Quartz/Apple Speech xizmatlari ko‘chirilmagan; mavjud Windows/Tauri/UIA/Whisper/eSpeak va providerlar ishlatiladi.

[Liquid Moshi qo‘llanmasi](README-LIQUID-UZ.md) · [O‘rnatish](INSTALL-UZ.md) · [Telegram/CMD/GitHub/MCP](localai-service/TOOLS-UZ.md) · [Mahalliy ovoz](localai-service/VOICE-UZ.md)

**Mahalliy o‘rnatish yakunlandi:** 0.7.0, Telegram sessiyasi qayta ulandi, o‘rnatilgan Codex adapteri haqiqiy javob qaytardi. [Yakuniy tekshiruv, paket hashları va cheklovlar](VERIFICATION-0.7.0-UZ.md). GitHub’ga push bajarilmadi.
