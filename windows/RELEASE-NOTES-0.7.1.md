# BIMO AI 0.7.1 — Windows x64

BIMO AI bir installerda liquid Moshi, LocalAI Studio, Telegram, mahalliy o‘zbekcha ovoz va Windows vositalarini beradi. Ushbu reliz avval mahalliy ishlatilgan 0.6.5 va 0.7.0 imkoniyatlarini ham GitHub’da tarqatadi.

- **Yangi nom:** BIMO AI. Repozitoriy `Ahmadjon0worker/BIMO-AI`; Start menyusi, tray, Studio, sozlamalar va installer moslangan.
- **Liquid Moshi:** besh burchakli animatsion hamroh, Thinking Orbs holatlari va QuickLiquid shisha ko‘rinishi saqlangan.
- **Moshi yordamchisi:** Windows UIA tugma/maydonlarini topish, ko‘rsatish va tekshiriladigan qadamlar; Codex/Claude CLI holati; DPAPI bilan shifrlangan afzallik xotirasi va amallar metama’lumotlari.
- **Ovoz:** Ctrl+Shift+Space orqali ushlab gapirish, jumlalab TTS va bekor qilish. «OK Bimo»/«Бимо» qo‘shilgan; eski iboralar ham ishlaydi. O‘zbekcha NavAI Whisper modeli va Silero VAD installer ichida.
- **Telegram va providerlar:** mavjud chat, tarix, qidiruv, xabar/reply hamda aniq yuborish buyruqlari; Ollama → Gemini → Groq Auto rejimi saqlangan.
- **Yangilash:** tanilgan per-user Qanot AI/Coucou EXE o‘rnatmasi avvalgi papkada yangilanadi. Sozlamalar, Telegram sessiyasi, credential va ichki CLI/hook nomlari mosligi saqlanadi. MSI UpgradeCode avvalgi Qanot AI bilan bir xil.

**O‘rnatish:** `BIMOAI-Windows-0.7.1-setup.exe` relizga joylangan. Windows 10/11 x64 va WebView2 talab qilinadi; Ollama va katta chat modellari alohida o‘rnatiladi. `SHA256SUMS.txt` bilan paketni tekshiring. Private repozitoriydan yuklash uchun ruxsatli GitHub hisobiga kiring. MSI mahalliy yig‘ilgan va chiqarib tekshirilgan, ammo eski MSI papka/startup migratsiyasi sinovi tugamagani uchun relizga yuklanmagan.

[To‘liq qo‘llanma](INSTALL-UZ.md) · [Moshi imkoniyatlari](README-PLIP-UZ.md) · [Tekshiruv dalillari](VERIFICATION-0.7.1-UZ.md).

Haqiqiy mikrofon/xona, MSI o‘rnatish va toza VM sinovlari hali bajarilmagan. AI CLI kartasi tayyor bo‘lishi avtomatik Telegram/desktop vakolatini bermaydi; bu kartadagi javob matn rejimida ishlaydi. Telegram’da aniq yuborish buyrug‘i mavjud yuborish oqimi orqali bajariladi.

Manba kodi MIT va upstream Louis Raillé attribution’i saqlanadi. Mochi asosidagi Moshi artwork’i alohida `LICENSE-ASSETS.md` va foydalanuvchi tasdiqlagan yozma ruxsatga bog‘liq. Thinking Orbs, QuickLiquid va Plip MIT xabarnomalari, Whisper/NavAI/Silero/eSpeak litsenziyalari paket ichida.
