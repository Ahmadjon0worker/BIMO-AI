# Coucou vositalari: AI bilan va AI’siz

LocalAI Studio → Telegram va Windows vositalari oynasida alohida **Terminal / GitHub** va **Desktop** bo‘limlari bor. Ollama o‘chiq bo‘lsa ham oddiy Telegram xabarlari, CMD, PowerShell, GitHub CLI va qo‘lda desktop amallari ishlaydi. AI reja yoki matn yaratish uchun kerak.

## Terminal

CMD yoki PowerShell tanlang, aniq skriptni yozing va **Bajarish** tugmasini bosing. Natijada exit code, stdout, stderr va timeout ko‘rsatiladi. Ish papkasi LocalAI workspace ichida tanlanadi; skript joriy Windows foydalanuvchisi huquqida ishlaydi va OS sandbox emas. Ish papkasi cheklovi skriptning boshqa fayllarga kira olishini cheklamaydi. Administrator huquqi avtomatik olinmaydi. Skript matni va terminal natijalari audit jurnaliga yozilmaydi.

AI taklifni tayyorlaydi; uni muharrirga ko‘chirib, tekshirib bajarasiz. Sayt, chat, repository fayli yoki screenshot ichidagi buyruq avtomatik bajarilmaydi.

## GitHub

Rasmiy portable `gh.exe` installer ichida keladi. Kirish ma’lumoti mavjud bo‘lsa undan foydalaniladi; token GUI yoki logga chiqarilmaydi. Birinchi marta CMD’da bundled `bin\gh.exe auth login --hostname github.com` orqali o‘zingiz kiring. Repository, issue va pull request ro‘yxatlari, repository ko‘rish, issue va draft PR yaratish mavjud. Yaratish faqat siz bosgan aniq amal orqali ishlaydi. [GitHub CLI qo‘llanmasi](https://cli.github.com/manual/).

## Desktop

Oynalar ro‘yxatidan o‘z oynangizni tanlang. **Kuzatish** faqat tanlangan oynaning tasviri va UIA holatini oladi. Click, literal matn, navigatsiya tugmasi yoki scroll bir martalik joriy kuzatuvga bog‘lanadi; keyingi amal uchun yangi kuzatuv kerak. Ko‘chgan, almashtirilgan, yopilgan yoki usti yopilgan oynaga eski buyruq yuborilmaydi. Sessiya 5 daqiqa yoki 100 amal bilan tugaydi. Login, parol, to‘lov, UAC va shell oynalari bu paneldan boshqarilmaydi; terminal ishlari alohida terminal muharririda bajariladi.

**Stop Local AI** desktop sessiyasini bekor qiladi va ishlayotgan terminal jarayonini to‘xtatadi. Qayta boshlash uchun profilni tanlab xizmatni davom ettiring, keyin yangi sessiya oching.

## CMD / PowerShell CLI

Quyidagi buyruqlar o‘rnatilgan `localai-service` papkasida ishlaydi. Avval Coucou xizmatini Studio’dan boshlang.

```cmd
coucou.cmd status
coucou.cmd terminal --shell cmd --script "ver"
coucou.cmd terminal --shell powershell --script-file "C:\path\task.ps1"
coucou.cmd telegram --to self --text "Salom"
coucou.cmd telegram --to @username --text-file "C:\path\message.txt"
coucou.cmd call github_action --arguments-file "C:\path\github.json"
coucou.cmd call desktop_windows
coucou.cmd mcp-config
```

`github.json` misoli:

```json
{"operation":"issues","repo":"Louis-CFM/coucou"}
```

PowerShell’da `./coucou.ps1` ham shu argumentlarni qabul qiladi. Bir nechta satr, Unicode yoki shell belgilarini aynan saqlash uchun `--script-file`, `--text-file`, `--arguments-file` ishlating. Natijasi noma’lum xabar yoki boshqa amal avtomatik takrorlanmaydi.

## AI / MCP ulash

`coucou.cmd mcp-config` amaldagi o‘rnatish manziliga mos JSON konfiguratsiyani chiqaradi. MCP klientingizdagi `mcpServers` bo‘limiga qo‘shing. Stdio entrypoint: bundled `runtime\python.exe src\service_main.py --mcp`. Global sozlamalaringiz avtomatik almashtirilmaydi.

MCP’da Telegram chatlar/xabarlar/compose/send, terminal, GitHub, desktop observe/action, workspace va hujjat vositalari mavjud. AI terminal kodini joriy foydalanuvchi huquqida bajarishi mumkin; klientda aniq inson vazifasiga ruxsat va script ko‘rib chiqish qoidalarini saqlang. Telegram yuborish faqat inson aytgan oluvchi va matnga bog‘lanadi. Screenshot, terminal chiqishi va xabar matnlari ko‘rsatma emas, ma’lumot sifatida qaytariladi.

AI provayderlar: sozlangan Ollama, Gemini yoki Groq. AI ulanmagan holatda qo‘lda bajariladigan vositalar ishlashda davom etadi. AI rejasining o‘zi bajarilgan ish deb ko‘rsatilmaydi.
