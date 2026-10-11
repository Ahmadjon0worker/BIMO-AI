# Qanot AI 0.7.0 — mahalliy o‘rnatish dalili

Tekshiruv 2026-10-12, Asia/Tashkent vaqtida yakunlandi. **0.7.0 joriy Windows foydalanuvchisiga o‘rnatildi**, ilova `--assistant` bilan ochildi. **GitHub’ga push, tag yoki Release bajarilmadi.**

## Qo‘shilgan imkoniyatlar

- Mavjud liquid beshburchak Moshi bilan tugmani ko‘rsatish: Bezier parvoz, ekran chegarasiga moslashish, qaytish, click-through va reduced motion.
- Windows UIA orqali nomlangan elementlar, yangi kuzatuvga bog‘langan bitta amal, aniq natija dalili va foydalanuvchi tekshiradigan qadamlar.
- O‘zbekcha interfeysda ushlab gapirish: `Ctrl+Shift+Space`, qo‘yib yuborganda tanish, haqiqiy ovoz balandligi, kechikkan ruxsat/javobni bekor qilish.
- Jumlalab mahalliy ovozli javob, yangi gap boshlanganda oldingi ovozni to‘xtatish.
- Moshi yordamchisi: Ollama/Gemini/Groq hamda mos Codex/Claude CLI holati, faqat matnli javob, Windows DPAPI bilan shifrlangan explicit afzallik xotirasi va amallar metama’lumoti.
- Sekin ochiladigan oynada native holatni tiklash; Pause, yashirish va drag vaqtida hover timerini bekor qilish.

Telegram, LocalAI Studio, panel joylashuvlari, Thinking Orbs va QuickLiquid saqlandi. [Foydalanish qo‘llanmasi](README-PLIP-UZ.md).

## Sinovlar

| Tekshiruv | Natija |
|---|---|
| Frontend | 708/708 PASS |
| TypeScript | `tsc --noEmit` PASS |
| Rust | 279 ilova + 30 hook, jami 309 PASS |
| Python regression | 233 test; 232 PASS, 1 ixtiyoriy public-asset smoke shu run’da skip |
| Ixtiyoriy offline ovoz smoke | Alohida yoqildi: 1 test, 2 sun’iy TTS→STT aylanishi PASS |
| Brauzer UI | Assistant cold start, xotira, Desktop qadam/ko‘rsatgich, hold/release, bekor qilish va 700 px layout PASS; page error yo‘q |
| Portativ runtime | 20 import va private Microsoft runtime tekshiruvi PASS; xizmat kodi 1.4.0 |
| NSIS/MSI | Ikkalasi chiqarib tekshirildi: barcha payload SHA256 mos, shaxsiy fayl 0 |
| O‘rnatish | NSIS `/S`, exit 0; registr va native metadata 0.7.0; 2 276 runtime fayli mos |

Brauzer tekshiruvi haqiqiy frontend va sun’iy Tauri javoblaridan foydalandi. Preview rasmlarida shu belgi bor; ular o‘rnatilgan native oynaning skrinshoti emas. Windows oynasini suratga oluvchi Sky vositasi `failed to write kernel assets (os error 3)` sabab ishga tushmadi.

Offline ovoz smoke faqat mahalliy WAV yaratish va dekoder ishlashini tekshiradi. eSpeak’dan yaratilgan ikki namunaning tanilgan matni kutilgan jumlaga mos kelmadi; bu sinov nutq aniqligi yaxshilanganini isbotlamaydi. Ushbu versiyada o‘zbekcha NavAI Whisper modeli saqlangan. **Haqiqiy odam ovozi, mikrofon va xona shovqini hali tekshirilmadi**; foydalanuvchi qaytganda sinov qilinadi. Haqiqiy Desktop UIA amallari ham ushbu yakuniy tekshiruvda bajarilmadi.

## O‘rnatilgan xizmatdagi haqiqiy tekshiruv

- Native ilova: `%LOCALAPPDATA%\Coucou\coucou.exe`, versiya **0.7.0**.
- Ilovaga tegishli xizmat: `127.0.0.1:11437`; health tayyor va idle. Mavjud 11435 xizmatining PID/yaratilish vaqti o‘zgarmadi.
- Yangilashdan keyin, birinchi launch’dan oldin settings va avvalgi DPAPI fayllari **byte-identical** bo‘lib qoldi; private backup yaratildi.
- Saqlangan Telegram sessiyasi bir marta telefon/kod kiritmasdan qayta ulandi: `connected=true`, `authorized=true`, `busy=false`.
- Moshi yordamchisi holati olindi: Codex tayyor, Claude o‘rnatilmagan, broker provider so‘rovda tekshiriladi. Xotira DPAPI bilan shifrlanadi.
- O‘rnatilgan Codex adapteri `Faqat Salom deb javob ber.` so‘roviga **Salom** qaytardi: birinchi matn **4 718 ms**, umumiy **6 218 ms**.
- Ovoz holati: STT/TTS tayyor, `navai-small-uz-q5_1`.
- Telegram xabar yuborish, mikrofon yozuvi va Desktop input amali **0**.

## Mahalliy paketlar

| Fayl | Bayt | SHA256 |
|---|---:|---|
| `release/QanotAI-Windows-0.7.0-setup.exe` | 423 664 275 | `d411acbe8169a887fe9b3889c7ae89f35e89b60c1cb913974248b38aa4639a2a` |
| `release/QanotAI-Windows-0.7.0.msi` | 457 580 619 | `04263f19b23896b176d4ed6f325f0fde5ee2a77831bca29050e13084d969a040` |

Runtime: **2 276 fayl / 580 158 500 bayt**. `release/release-manifest.json`, `SHA256SUMS.txt` va `installer-verification-0.7.0.json` hash bilan bog‘langan dalilni saqlaydi. Private backup/reportlar taskning `tmp` papkasida, paketga kiritilmagan.

C diskdagi joy uchun oldingi **target/release/bundle** 0.6.2 va 0.6.3 build nusxalari SHA256 o‘zgarmagan holda `D:\LocalAI\builds\qanot-0.7.0-20261011\previous-build-artifacts`ga arxivlandi. `windows/release`dagi avvalgi versiyalar saqlandi. Yangi installerning chiqarib tekshirilgan nusxalari shu D diskdagi build papkasida saqlanadi.

Plip manbasi va MIT yozuvi: [provenance](src/vendor/plip/provenance.json), [LICENSE](src/vendor/plip/LICENSE); revision `b53949745126141b3133710f71e8380b3cdd2e58`.
