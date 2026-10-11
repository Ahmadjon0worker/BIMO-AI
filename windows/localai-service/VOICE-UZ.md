# Qanot AI Windows ovozli boshqaruv

Paneldagi LocalAI → Telegram va Windows vositalari → **Ovoz** bo‘limini oching.
«Gapirish»ni bosing, aniq gapiring. «Gapirdim» yoki bir soniya sukut yozuvni yakunlaydi.
Nutq shu kompyuterda taniladi. O‘zbekcha uchun NavAI o‘zbek nutqiga moslashtirgan Whisper small Q5_1,
ruscha va inglizcha uchun multilingual small-q5_1 avtomatik tanlanadi. Modellar installer ichida;
tanib olish uchun internet yoki AI provider kaliti kerak emas. O‘zbek modelida Silero VAD nutq bo‘lmagan
qismlarni ajratadi; timestamp dekodlash o‘chirilgan, chunki model shu tartibda o‘qitilgan.
Ovoz javobi uchun «Javobni mahalliy ovozda o‘qish»ni yoqing: eSpeak NG o‘zbekcha ovozi installer ichida.
eSpeak ovozi robotga o‘xshaydi; tabiiy odam ovozi deb va’da qilinmaydi.

Oldingi 0.6.2 sinovida bir xil sakkizta ommaviy o‘zbekcha nutq namunasida so‘z xatosi (WER) 115,70% dan 20,66% ga,
belgi xatosi (CER) 43,70% dan 7,99% ga kamaydi. WER qo‘shimcha so‘zlar sabab 100% dan oshishi mumkin.
Bu 66 soniyali kichik sinov to‘plami; barcha odamlar va mikrofonlar uchun aniqlik kafolati emas.
Sukut, g‘uvillash va sof shovqin sinovlari bo‘sh natija berdi. Nutq bilan aralashgan shovqin,
ismlar va username hali xato tanilishi mumkin. [Sinov tafsilotlari](VOICE-UZ-BENCHMARK.md).
«Eshitilgan buyruq» matnini tahrirlash mumkin. Xabarni avval tekshirish uchun «darhol yuborish»ni
o‘chiring; oddiy matnli Telegram buyruqlari avvalgidek ishlaydi.

## Buyruqlar

- «Panelni och», «Panelni ixcham qil», «Sozlamalarni och», «Studioni och».
- «Telegramni och», «Terminalni och», «Kompyuter boshqaruvini och».
- Chatlarni yuklang, qabul qiluvchini tanlang: «Shu chatga salom yubor».
  Telegram sessiyasi avvalgidek saqlanadi. Aniq yuborish buyrug‘i sukut bo‘yicha darhol yuboriladi.
  Xabarni avval ko‘rish uchun «darhol yuborish» belgisini o‘chiring. «Qoralama» buyrug‘i avtomatik yuborilmaydi.
  Yuborish natijasi noma’lum bo‘lsa qayta yuborilmaydi: Telegramni tekshirib natijani tasdiqlang.
- «GitHub holatini ko‘rsat», «Repolarimni ko‘rsat»: mavjud GitHub CLI orqali haqiqiy natija.
- «Soat necha», «Windows versiyasini ko‘rsat», «CMD: ver»: buyruq terminal muharririga tushadi.
  Mavjud bajarish tugmasini bosing. AI reja ham shu tartibda ko‘rib chiqiladi.
- «Hammasini to‘xtat»: LocalAI, terminal va ovoz ishlari to‘xtaydi.
  Davom etish uchun panelda ECO/BALANCED/QUALITY rejimini tanlang, ovoz holatini yangilang.

Davomli tinglash ixtiyoriy. Belgini yoqing, keyin «Gapirish»ni bosing.
Bu rejimda «OK Qanot» bilan boshlangan buyruq bajariladi; «OK Kanot» va kirillcha Qanot/Kanot shakllari ham taniladi. Eski «OK Coucou», «Kuku», «Куку» iboralari moslik uchun saqlanadi.
Ovoz yozuvi eng ko‘pi 15 soniya; bir vaqtda bitta transkripsiya.
Whisper ba’zan so‘zlarni xato taniydi, ayniqsa username, shovqin va juda qisqa nutqda.
Username’ni taxmin bilan tuzatmaydi; qabul qiluvchini ro‘yxatdan aniq tanlash tavsiya etiladi.
Murakkab terminal/GitHub/desktop vazifasi sozlangan Ollama/Gemini/Groq orqali reja oladi.
Oddiy buyruqlar va literal Telegram xabari uchun AI provider shart emas.
Erkin suhbat uchun LocalAI Studio mavjud.

**Haqiqiy mikrofon/xona sinovi hali bajarilmagan.** Yuqoridagi ommaviy audio natijalari yangi 0.6.3 installer tekshiruvi deb ko‘rsatilmaydi.

## Mikrofon

Windows Settings → Privacy & security → Microphone → «Let desktop apps access your microphone» yoqilgan bo‘lsin.
Windows/WebView2 so‘rasa Qanot AI mikrofon ruxsatini tasdiqlang. Ilova ishga tushganda mikrofon avtomatik ochilmaydi.
Ovoz bo‘limidan chiqish, oynani yashirish, «Ovozni to‘xtatish» yoki Stop mikrofon treklarini yopadi.
Ovoz va transkript alohida jurnalga saqlanmaydi. Vaqtinchalik WAV va decoder natijasi ish tugagach o‘chiriladi.
Telegram buyrug‘i yuborilganda uning matni odatdagi Telegram API orqali yuboriladi;
AI reja so‘ralganda vazifa tanlangan providerga yuboriladi.

## Litsenziyalar va manbalar

Whisper.cpp v1.9.4/b5130: https://github.com/ggml-org/whisper.cpp/releases/tag/b5130 (MIT).
Multilingual small-q5_1 modeli: https://huggingface.co/ggerganov/whisper.cpp (OpenAI Whisper MIT).
O‘zbekcha model: https://huggingface.co/navai-uz/whisper-small-uzbek (Apache-2.0),
aniq revision va konvertatsiya `voice/uzbek/MODEL-SOURCE.json` ichida.
Silero VAD v6.2.0: https://huggingface.co/ggml-org/whisper-vad (MIT), manba va revision
`voice/uzbek/VAD-SOURCE.json` ichida. Model va VAD xeshlari manifestdan mustaqil ham tekshiriladi.
Modelni manbadan qayta tayyorlash tartibi loyiha ichidagi `model-preparation/README.md` faylida.
eSpeak NG 1.52.0 release: https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0 (GPLv3).
Ovoz komponentlari manifestlarda SHA256 bilan tekshiriladi. eSpeak uchun COPYING/GPL matni
`voice/tts/LICENSE-espeak.txt`, tegishli manba kodi `licenses/espeak-ng-source.tar.gz` ichida tarqatiladi.
O‘zgartirilmagan rasmiy Windows komponentlari alohida jarayon sifatida ishlaydi; tizimga eSpeak o‘rnatilmaydi.


Qanot AI nomi o‘zgarsa ham, avvalgi panel va Telegram sozlamalari legacy Coucou ma’lumot yo‘llari orqali saqlanadi. Ovoz bu ma’lumotlarni boshqa papkaga ko‘chirmaydi.
