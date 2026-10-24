# korea-trip 🇰🇷

5 人共編韓國旅遊工具:收藏景點/美食/展覽/醫美、投票、排行程、記帳分帳(韓元 ↔ 新台幣)。

網址:https://btj4hwyj4s-crypto.github.io/korea-trip/

## 使用
開啟網址 → 輸入大家約好的邀請碼 → 點選自己的名字。到「設定」可修改 5 位成員名字、出發日期、天數、匯率。

## 轉成 Firebase 共編
目前未設定 Firebase 時是「本機測試模式」(資料不同步)。
1. Firebase 主控台建立專案 → 建立 Firestore Database。
2. 專案設定 → 新增網頁應用程式 → 複製 config,貼到 `firebase-config.js`。
3. Firestore 規則(5 人私用,以邀請碼當房間路徑):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /rooms/{room}/{document=**} { allow read, write: if true; }
     }
   }
   ```
   注意:知道邀請碼的人都能讀寫,請使用不易猜的邀請碼,不要存敏感資料。
4. commit 並 push,GitHub Pages 會自動更新。
