# Qanot AI + LocalAI Studio — Windows 0.6.3

Qanot AI — Coucou MIT manba kodi asosida tayyorlangan, o‘z nomi va yangi Qanot hamroh ko‘rinishiga ega Windows nashri. Panel, LocalAI Studio va Telegram imkoniyatlari saqlanadi.

Installer Qanot AI paneli, alohida LocalAI Studio oynasi, Telegram va Windows vositalari hamda Python xizmatini birga o‘rnatadi. Auto rejimi Ollama → sozlangan Gemini → Groq tartibida ishlaydi. Windows x64 uchun asosiy installer `release/QanotAI-Windows-0.6.3-setup.exe`. O‘rnatish, API kalitlari va vositalardan foydalanish bo‘yicha [o‘zbekcha qo‘llanma](INSTALL-UZ.md) mavjud; qo‘llanma installer ichiga ham kiritilgan.

Telegram oynasida chat qidirish va filtrlash, keyingi chatlarni ochish, Saved Messages va username bo‘yicha chatga kirish, tarixni yuklash va qidirish, oddiy xabar yuborish, reply, AI javob, tarjima va xulosa mavjud. Aniq yuborish buyrug‘i yoki tugmasi xabarni darhol yuboradi. Chatni almashtirish tayyor xabarning adresatini o‘zgartirmaydi; natijasi noma’lum yuborish avtomatik takrorlanmaydi. Eski LocalAI xizmati 11435 portini band qilsa, yangi Telegram bridge 11437 portida ishlaydi.

- Sozlamalar → Umumiy → Til: **O‘zbekcha**. Panel, sozlamalar va tray menyusi bir vaqtda tilni almashtiradi.
- Codex holati: o‘ylash, ishlash, qidirish, ruxsat/javob kutish, tugash, xato va limit. Yakuniy javob mavjud bo‘lsa, tugash holati keyingi vazifagacha saqlanadi. To‘xtatilgan yoki xato bilan tugagan vazifada oldingi javob tozalanadi.
- Tez sozlash: **Sokin** — ovozsiz, 10 soniyada yopilish; **Muvozanatli** — past ovoz, 20 soniya; **Uzoqroq ko‘rsatish** — past ovoz, 60 soniya. Bu vaqtlar sichqoncha paneldan chiqqandan keyin hisoblanadi; ruxsat kartasi javob kutishni davom ettiradi.
- Umumiy → Windows bilan avtomatik ochish: ishga tushish sozlamasi. Ovoz, ekran va klaviatura yorliqlari alohida sozlanadi.
- Panelni ko‘chirish: katta panelning yuqori qatoridagi yoki ixcham paneldagi **⠿** tutqichini ushlab sudrang. Ko‘rinadigan panelni chet yoki burchakkacha olib borib, qo‘yib yuboring. Sensorli ekran uchun pointer harakatlari ham qo‘llab-quvvatlanadi. Joylashuv avtomatik saqlanadi; panel ochilib-yopilganda yoki Qanot AI qayta ishga tushganda markazi va balandligi saqlanadi. Chegaralar Windows ish maydoniga moslanadi.
- Avvalgi joyiga qaytarish: **⠿** tutqichini ikki marta bosing yoki Sozlamalar → **Yuqori markazga qaytarish**. Boshqa ekran tanlanganda panel o‘sha ekranning yuqori markaziga qaytadi.
- Moslashuvchi panel: tutqichni ekran ish maydonining chetiga yaqin qo‘yib yuboring. Yuqori/pastda 288×32 gorizontal panel, yonlarda 40×192 vertikal tasma, burchaklarda 80×80 kvadrat bo‘ladi. Ko‘rinadigan panel chetga tekis yopishadi; Windows vazifalar paneli uchun joy saqlanadi. Joy va shakl qayta ochishda saqlanadi.
- Sozlamalar → Umumiy → **Panelning joyi** orqali to‘qqiz joylashuvni tanlash mumkin. Kengaygan paneldagi **−** tugmasi uni ixchamlaydi; kutayotgan ruxsat yoki savol bekor qilinmaydi.

Codex hooklari `%USERPROFILE%\.codex\hooks.json` ichida. Yangi hooklarni Codex’da `/hooks` yoki ilova sozlamalaridagi Hooks orqali bir marta tekshirib tasdiqlash kerak. Ulanish sinovi relay’ni tekshiradi; haqiqiy Codex sessiyasi alohida tasdiqlashni talab qiladi.

Tarjimalar `src/i18n/uz.json` ichida saqlanadi. Avtomatik yaratiladigan Mac katalogi o‘zgartirilmaydi; yangi brend matnlari Windows tarjima katalogida ustidan qo‘shiladi. Tarjima tekshiruvi barcha katalog kalitlari va `{name}` kabi o‘rinbosarlarni tekshiradi.

Yig‘ish: avval `localai-service/README.md` bo‘yicha portable runtime tayyorlanadi. Node.js, Rust va MSVC C++ Build Tools o‘rnatilgach, `windows` ichida `npm ci`, so‘ng `npm run pack`. Yig‘ish runtime fayllarining ro‘yxati, xeshlari va manba kodiga mosligini tekshiradi. Installerlar `release` papkasiga yoziladi.

Windows tarqatish skripti EXE va MSI arxivlarini o‘rnatmasdan ochib, ichidagi ilova, hook, qo‘llanma va runtime fayllarining SHA-256 summalarini tekshiradi. Yig‘ish kompyuterida Tauri’ning WiX `dark.exe` keshi va 7-Zip kerak; ular tayyor installer foydalanuvchisiga kerak emas. 7-Zip `C:\Program Files\7-Zip\7z.exe` yoki loyiha ishchi papkasidagi `tmp/installer-verification-tools/portable/7z.exe` orqali topiladi. Batafsil: `scripts/verify-installers.ps1`. Oldin olingan muvaffaqiyatli hisobotni `node scripts/pack.mjs --verification-report <report.json>` orqali ishlatish mumkin; skript paket va barcha joriy runtime fayllarining summalarini yana solishtiradi. Fayl vaqtining o‘zgarishi to‘g‘ri paketni xato eskirgan deb belgilamaydi.

Tekshiruv uchun PATH yoki PSHOME orqali topilgan PowerShell 7 afzal tanlanadi; topilmasa Windows PowerShell ishlatiladi. Zarur bo‘lsa `COUCOU_PACK_POWERSHELL` muhit o‘zgaruvchisida tekshiruv hostining to‘liq yo‘lini ko‘rsating. Bu faqat manbadan yig‘ishga tegishli; tayyor ilovani ishlatish uchun PowerShell 7 kerak emas.

## Ovoz va saqlangan imkoniyatlar

Custom panel va Telegram messenger saqlanadi. Windows upstream’dan hover, klaviatura navigatsiyasi,
pill ranglari va shaxsiy notification ovozlari tanlab ko‘chirildi.
Studio → Ovozli boshqaruv yoki Telegram va Windows vositalari → Ovoz orqali mahalliy nutq boshqaruvi ochiladi.
O‘zbekcha nutq uchun NavAI Whisper small Q5_1 va Silero VAD, ruscha/inglizcha uchun multilingual
small-q5_1 hamda o‘zbekcha eSpeak NG installer ichida. Mikrofon faqat tugma bosilganda yoqiladi.
Oldingi 0.6.2 sinovida sakkizta bir xil ommaviy audio namunasida o‘zbekcha so‘z xatosi 115,70% dan 20,66% ga kamaydi.
Ismlar va shovqinli nutq xato tanilishi mumkin; eshitilgan matnni tahrirlash va xabarni yuborishdan avval ko‘rish mumkin.
O‘zbekcha buyruqlar panel, Telegram, GitHub va terminal muharririga ulanadi; AI reja uchun mavjud Auto/Ollama/Gemini/Groq ishlaydi.
[Ovoz qo‘llanmasi](localai-service/VOICE-UZ.md) mikrofon, buyruq namunalari va cheklovlarni tushuntiradi.

## Moslik va reliz holati

Yangi EXE standart papkasi `%LOCALAPPDATA%\Qanot AI`. Sozlamalar `%APPDATA%\Coucou`, LocalAI ishchi fayllari va Telegram sessiyasi `%LOCALAPPDATA%\Coucou\LocalAI` ichida saqlanadi. `coucou.exe`, CLI/hook nomlari, credential va xizmat protokoli identifikatorlari eski o‘rnatma bilan moslik uchun saqlanadi; ularni qayta nomlamang. Davomli ovozli boshqaruvda «OK Qanot» ishlatiladi; «OK Coucou / Kuku» ham saqlanadi.

0.6.3 uchun yangi tekshiruvlar [reliz qaydlarida](RELEASE-NOTES-0.6.3.md) beriladi. Oldingi 0.6.2 natijalari yangi paket tekshiruvi deb ko‘rsatilmaydi. Haqiqiy mikrofon/xona, MSI o‘rnatish va toza VM sinovi hali bajarilmagan. Build tartibi: [asosiy README](../README.md#manba-kodi-va-yigish), Node.js 24 va Python 3.12+ bilan [runtime bootstrap](scripts/RUNTIME-BOOTSTRAP.md).
