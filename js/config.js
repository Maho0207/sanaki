// ===== 早菜島軌道 サイト設定 =====
// GitHub に公開する前にここを編集してください。
export const CONFIG = {
  siteName: '早菜島軌道',
  siteNameEn: 'SANAJIMA KIDO',

  // Google Apps Script の「ウェブアプリ」URL(gas/Code.gs をデプロイして取得)
  // 空のままだと、特急予約はこの端末だけに保存される「デモモード」で動きます。
  gasUrl: 'https://script.google.com/macros/s/AKfycbw83sxu5zCfLLi8JxWbWBuon7dv0KDbUvA7Pdj4vVwfZQe8Nah0ibzFroxJQCr5RmM4/exec',

  // ランダムな運転見合わせ・車両の自動離脱(検査・事故)の設定は data/sim.json にあります
  // (スプレッドシートの Apps Script も同じファイルを読みます)

  // 特急車の形式ごとに優先して充当する路線(上から順に割り当て)。座席配列は data/seatmaps.json
  seriesPreference: {
    '5000型': [5], '5500型': [5],   // Air Express: 空港線の運用へ優先充当
    '4000型': [4],                   // Cherry Express: 桜川線
    '3000型': [7],                   // Island Express: 早菜離島線
    '2000型': [2, 9],                // Ocean Express: 東部海岸線・西部海岸線
    '1000型': [1, 3, 8], '1500型': [1, 3, 8], // Mountain Express: 山岳線・東越線・天連峡谷線
    '6000型': [],                    // Premium Express: 指定なし
  },
  maxSeatsPerReservation: 6,
  reserveDaysAhead: 14,          // 何日先まで予約できるか
  // 運賃・特急料金は data/fare.csv(キロ数,新運賃,…)と data/limited_express_fee.csv(~まで,料金)で設定します。
  // 1km 未満の端数は切り上げ。表の最大キロを超える場合は最終行の金額を適用します。
};
