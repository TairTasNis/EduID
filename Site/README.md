# EduID

Локальный сайт на Next.js, React и TypeScript. После входа ученика открывается белая страница с ФИО, классом и уведомлением об импорте в правом нижнем углу. Для организаций доступна заявка с ручной проверкой документов.

## Запуск

```powershell
Set-Location 'D:\ImportGrade\EduID'
npm.cmd ci
npm.cmd run dev:local
```

Откройте [EduID на localhost](http://localhost:3000). `dev:local` запускает локальные эмуляторы Firebase Auth, Realtime Database и Storage и подключается к действующему Grade API через настройки SSH-профиля `oci`. Для первого запуска нужны Java и доступ к npm. При штатном завершении данные сохраняются в `.eduid-local/firebase`. Ссылки из писем Firebase Auth в этом режиме появляются в терминале.

Для работы с облачным Firebase заполните `.env.local` по инструкции ниже и запустите `npm.cmd run dev`. Для проверки сборки используйте `npm.cmd run build`.

## Firebase

1. В проекте `eduid-tfg` включите Authentication → Email/Password. Добавьте домен сайта в Authorized domains. Для локальных проверок добавьте `localhost`, если его ещё нет.
2. В Realtime Database откройте нужный экземпляр и скопируйте точный URL в `NEXT_PUBLIC_FIREBASE_DATABASE_URL`. Примените `database.rules.json`. В Cloud Storage примените `storage.rules` и сохраните закрытый доступ на уровне IAM бакета. Приложение использует `eduid-tfg.firebasestorage.app` для документов.
3. Используйте JSON сервисного аккаунта с доступом к Firebase Auth, Realtime Database и объектам нужного бакета. Для локального запуска укажите абсолютный путь к JSON в `GOOGLE_APPLICATION_CREDENTIALS` файла `.env.local`. Для Vercel задайте содержимое JSON в серверной переменной `FIREBASE_SERVICE_ACCOUNT_JSON`. Сгенерируйте постоянный `EDUID_ID_HMAC_KEY` командой ниже.

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
```

На этапе реального запуска проверьте размещение и обработку персональных данных школьников и представителей, включая сканы, по применимым требованиям Казахстана. У Firebase Realtime Database опубликованы регионы за пределами Казахстана. [Статья 12 закона о персональных данных](https://adilet.zan.kz/rus/docs/Z1300000094) · [Регионы Firebase](https://firebase.google.com/docs/database/locations)

## Школьный Grade API

Укажите `GRADE_API_URL`, `GRADE_API_KEY` и `GRADE_API_CA_PEM`. Корневой сертификат лежит в `certs/grade-api-ca.pem`. Ключ можно скопировать через настроенный SSH-профиль `oci` и вставить в `.env.local` или в секрет Vercel.

```powershell
$key = ssh -o BatchMode=yes -o StrictHostKeyChecking=yes oci 'sudo -n cat /etc/grade-api-ingress/api-key'
if ($LASTEXITCODE -eq 0) { $key.Trim() | Set-Clipboard }
Remove-Variable key
```

При регистрации Grade API подтверждает школьный аккаунт. Для BilimClass используйте выданный школой логин, для СУШ укажите ИИН. EduID создаёт учётную запись Firebase Auth со стабильным UID, служебным адресом и производным от школьного пароля. Повторный вход проверяется через Firebase Auth. Для ранее созданных профилей следующий успешный вход один раз подтверждает школьный аккаунт и добавляет способ входа в Firebase Auth. Открытый пароль используется только во время проверки или фонового импорта и в Firebase не записывается.

Grade API поддерживает `mode: "profile"` для проверки профиля и списка учебных лет и `mode: "history", year: "2026"` для архива учебного года. Для BilimClass сохраняются предметы и оценки каждой доступной четверти, включая баллы, проценты и данные СОР и СОЧ. Для СУШ используются доступные оценки, критерии и табели. Если источник требует CAPTCHA, форма показывает ответ источника и сохраняет аккаунт только после подтверждённой авторизации.

Next.js запускает импорт через `after()`. Завершённые годы записываются по мере загрузки и остаются доступны после сбоя. При входе после ошибки импорт продолжится с оставшихся лет. На Vercel используется Node.js и 300 секунд на функцию с Fluid Compute. Если выполнение оборвалось без записи статуса, повторный вход возобновит импорт после истечения шестиминутной блокировки. [Настройка длительности функций](https://vercel.com/docs/functions/configuring-functions/duration)

## Заявки организаций

Форма принимает БИН или ИИН ИП, юридическое название, тип организации, корпоративный email, рабочий телефон, ФИО и должность представителя. PDF, PNG или JPG до 3 МБ попадает в закрытый Firebase Storage. Firebase Auth отправляет письмо для подтверждения корпоративного адреса. Заявка получает `pending_review`, а организация видит свой статус. Для проверки администратор открывает `organizationApplications` в Firebase Console, сверяет `proofPath` с объектом в Storage и проверяет `emailVerified` в Auth. Доступ к оценкам ученика имеет только его Firebase UID.

## Проверка на эмуляторах

Для тестовых аккаунтов запустите `npx.cmd firebase-tools emulators:start --project demo-eduid` и в другом окне запустите сайт с этими переменными. Для проверки учеников используйте тестовый Grade API с тем же контрактом.

```powershell
$env:NEXT_PUBLIC_USE_FIREBASE_EMULATORS = 'true'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000'
$env:FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
npm.cmd run dev
```
