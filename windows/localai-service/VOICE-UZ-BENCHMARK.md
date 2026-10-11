# O‘zbekcha nutqni tanish — takrorlanadigan sinov hisoboti

Sinov 2026-10-11 kuni Windows’da bajarildi. O‘zbekcha uchun `navai-small-uz-q5_1` modeli, `--no-timestamps` va Silero VAD 6.2.0 ishlatildi. Inglizcha va ruscha uchun oldingi ko‘p tilli model saqlanadi.

Bir xil **8 ta ochiq inson ovozi** (jami **66.12 soniya**) bo‘yicha belgilar xatosi **43.70% → 7.99%**, so‘z xatosi **115.70% → 20.66%** bo‘ldi. Har bir namunada belgilar xatosi kamaydi. Bu kichik, oldindan tanlangan to‘plam natijasi; barcha o‘zbekcha nutq aniqligi haqidagi baho emas.

| Ko‘rsatkich | Avvalgi `small-q5_1` | Yakuniy o‘zbekcha model + VAD |
|---|---:|---:|
| So‘z tahrirlari / etalon so‘zlar | 140 / 121 | 25 / 121 |
| So‘z xato darajasi (WER) | 115.70% | 20.66% |
| Belgi tahrirlari / etalon belgilar | 350 / 801 | 64 / 801 |
| Belgi xato darajasi (CER) | 43.70% | 7.99% |
| Yakuniy ishlov vaqti, median | — | 5.243 soniya |
| Yakuniy 8 namuna uchun jami ishlov | — | 41.439 soniya |

WER — so‘z kiritish, o‘chirish va almashtirishlar sonining etalon so‘zlar soniga nisbati. Qo‘shimcha so‘zlar ko‘p kiritilganda 100% dan oshishi mumkin. CER xuddi shunday belgilar bo‘yicha hisoblanadi. Yakuniy vaqt CPU’da 4 oqim bilan, har safar jarayon va modelni yuklashni ham qamrab oladi. Oldingi model va turbo sinovlari qisqa vaqt birga ishlagan; ularning vaqtini yangi modelga nisbatan tezlik da’vosi uchun ishlatmaymiz.

## Audio manbasi va o‘lchash usuli

[Google FLEURS](https://huggingface.co/datasets/google/fleurs), `uz_uz`, `validation`; litsenziya **CC-BY-4.0**. Atributsiya: Google FLEURS; Conneau va boshqalar, “FLEURS: Few-shot Learning Evaluation of Universal Representations of Speech” (2022). Dataset preview’dagi dastlabki 15 soniyadan oshmagan 8 qator ASR natijalarini ko‘rishdan oldin tanlandi: **0, 1, 2, 4, 5, 6, 7, 8**. Hammasida mavjud `gender` metama’lumoti `1`; speaker ID yo‘q. Tanlov tasodifiy emas.

Asl audio 16 kHz, mono, 32-bit float WAV’dan 16-bit PCM WAV’ga aylantirildi. Har bir asl va PCM faylning SHA256 qiymati JSON hisobotda bor. Mikrofon yozuvi olinmadi; sinov faqat ochiq yoki dasturda yaratilgan audiolardan iborat. Audio namunalar installerga kiritilmaydi.

Matnlar Unicode NFKC va kichik harflarga aylantirildi; apostrof variantlari birlashtirildi, tinish belgilari bo‘shliqqa aylantirildi, so‘z chegarasidagi apostroflar olib tashlandi. So‘zlar bo‘shliqdan ajratiladi. Qo‘shimcha bir xil normalizatsiya o‘zbek kirill yozuvini lotinga transliteratsiya qiladi va 1–7 raqamli sonlarni o‘zbekcha so‘zlarga aylantiradi (`18ta` → `o‘n sakkizta`). Yakuniy va avvalgi modelning 8 namunadagi asosiy ko‘rsatkichlari xom apostrof-normalizatsiyali va shu qo‘shimcha normalizatsiyada bir xil. Hech qanday taxminiy imlo tuzatish, qoralama yaratish yoki yetishmagan so‘zni qo‘shish bajarilmadi. Belgi masofasida bo‘shliqlar hisoblanmaydi.

## Har bir namuna bo‘yicha natija

| Qator | Etalon so‘zlar | Avvalgi so‘z xatosi | Yakuniy so‘z xatosi | Avvalgi belgi xatosi | Yakuniy belgi xatosi |
|---|---:|---:|---:|---:|---:|
| 0 | 16 | 14/16 | 0/16 | 35/99 | 0/99 |
| 1 | 17 | 17/17 | 2/17 | 47/91 | 3/91 |
| 2 | 7 | 11/7 | 2/7 | 17/35 | 3/35 |
| 4 | 19 | 23/19 | 3/19 | 46/113 | 5/113 |
| 5 | 17 | 28/17 | 7/17 | 70/129 | 19/129 |
| 6 | 11 | 12/11 | 3/11 | 23/87 | 4/87 |
| 7 | 16 | 16/16 | 8/16 | 68/120 | 30/120 |
| 8 | 18 | 19/18 | 0/18 | 44/127 | 0/127 |

Har bir etalon va tanilgan matn, normalizatsiyadan keyingi ko‘rinishi, tahrirlar soni va native CLI argumentlari [VOICE-UZ-BENCHMARK.json](VOICE-UZ-BENCHMARK.json) ichida to‘liq saqlangan. 0 va 8-qator yakuniy matni normalizatsiyadan keyin etalonga to‘liq mos keldi. 7-qator eng qiyin bo‘lib, yakuniy WER 50% qoldi.

## Shovqin va sukunat nazorati

Takrorlanadigan sun’iy nazoratlar uchun random seed `20261011` ishlatildi. VAD’dan oldin 50 Hz elektr g‘uvillashi va RMS 400 birlik oq shovqin modeldan aloqasiz o‘zbekcha gaplar chiqargan. Yakuniy VAD bilan:

| 3 soniyalik nazorat | Yakuniy natija | Native ishlov |
|---|---|---:|
| Raqamli sukunat | Bo‘sh matn; `speech_detected=false` | Decoder chaqirilmadi |
| Peak 20 birlik juda past shovqin | Bo‘sh matn; `speech_detected=false` | Decoder chaqirilmadi |
| 50 Hz g‘uvillash, peak 800 | Bo‘sh matn; `speech_detected=false` | 406 ms |
| Oq shovqin, RMS 400 | Bo‘sh matn; `speech_detected=false` | 422 ms |

Native decoder g‘uvillash va oq shovqin uchun haqiqiy JSON fayl yozdi: `transcription: []`. Faylda `model`, `params`, `result`, `systeminfo`, `transcription` maydonlari bor edi; matn fayl yo‘qligidan yoki xato natijadan “sukunat” deb taxmin qilinmadi.

Bir inson ovoziga 15 dB SNR oq shovqin qo‘shilgan stress sinovida VAD nutqni o‘chirib yubormadi, ammo WER **85.71%**, CER **48.57%** qoldi (toza shu namuna: WER 28.57%, CER 8.57%). VAD shovqinning o‘zidan gap to‘qishni shu nazoratlarda to‘xtatdi; shovqinli nutqni to‘liq tuzatmaydi. Bu real xona yoki foydalanuvchi mikrofoni sinovi emas.

## Model identifikatori va qayta bajarish

[NavAI Whisper Small Uzbek](https://huggingface.co/navai-uz/whisper-small-uzbek/tree/4b432caf21c2752bca3384b5df1d41cf0da2801d), revision `4b432caf21c2752bca3384b5df1d41cf0da2801d`, Apache-2.0. Safetensors ma’lumotlari GGML F16’ga aylantirilib, `whisper.cpp 1.9.4-b5130` bilan Q5_1 kvantlashtirildi. Model egasining `generation_config.json` sozlamasida `return_timestamps=false`; `--no-timestamps` shu sozlamaga mos keladi. O‘qitishda ishlatilgan datasetlar haqidagi ma’lumot model egasiga tayanadi; ushbu namunalar bilan tarixiy o‘qitish ustma-ustligi mustaqil audit qilinmagan.

| Fayl | Hajm, bayt | SHA256 |
|---|---:|---|
| `ggml-small-q5_1.bin` — avvalgi | 190085487 | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| `ggml-navai-small-uz-q5_1.bin` — yakuniy | 190085504 | `b37c8935d4c2603404bdd7659a9e98c4f1f780712392de43d7a2c96fc5a8196b` |
| `ggml-silero-v6.2.0.bin` | 885098 | `2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987` |

[Silero VAD 6.2.0](https://huggingface.co/ggml-org/whisper-vad/tree/c5c26827b67dfd053856f92e824e14fdcc123daf), revision `c5c26827b67dfd053856f92e824e14fdcc123daf`, MIT. CLI/DLL va barcha model/provenance fayllari paket manifesti hamda alohida pin orqali tekshirildi.

Yakuniy ASR: `-l uz -t 4 -p 1 -ng -np -oj --no-timestamps --vad -vm ggml-silero-v6.2.0.bin -vt 0.5 -vp 200`; CLI default beam size va best-of ikkalasi `5`. Generik boshlang‘ich prompt qo‘shilmadi. Yangi katta turbo model ushbu ish uchun tanlanmadi: avvalgi 2 namunada kirill/Kazakhga o‘xshash, so‘z xatolari ko‘p matn chiqardi.

Loyiha workspace’ida tayyor WAV’lar va [benchmark skripti](../../../tmp/uz-voice-improvement/benchmark.py) mavjud. Mavjud fixture manifesti va WAV SHA256 qiymatlari o‘zgarmasligi tekshiriladi. Sinovni qayta ishga tushirish:

```powershell
& .\bundle\runtime\python.exe ..\..\..\tmp\uz-voice-improvement\benchmark.py --assets .\public-voice-uzbek --label navai-small-uz-vad-repeat
& .\bundle\runtime\python.exe ..\..\..\tmp\uz-voice-improvement\controls.py --label navai-controls-vad-repeat
```

## Mikrofon va maxfiylik

**Mikrofon yozuvi: 0. Bajarilgan buyruq va yuborilgan xabar: 0.** Telegram chatlari, telefon, kalit, token yoki shaxsiy xabarlar bu hisobotga kiritilmagan. Ovozning vaqtinchalik fayllari sinovdan keyin o‘chirildi. Foydalanuvchi kompyuter yoniga qaytgach mikrofon, talaffuz va xona shovqini bilan real sinov bajariladi.
