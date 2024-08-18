console.log("Content script loaded");

// チャットメッセージを送信する関数
function sendChatMessage(messages, model) {
  console.log("送信するメッセージ:", messages);
  console.log("使用するモデル:", model);

  chrome.runtime.sendMessage(
    {
      action: "sendMessage",
      messages: messages,
      model: model,
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error("エラー:", chrome.runtime.lastError);
        return;
      }

      if (response && response.error) {
        console.error("バックグラウンドスクリプトエラー:", response.error);
        return;
      }

      console.log("メッセージがバックグラウンドスクリプトに送信されました", response);
    }
  );
}

// チャットウィンドウからのメッセージを受信するリスナー
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "chatComplete") {
    console.log("Chat response received:", request.result);
    // ここでUIを更新するなどの処理を行う
  } else if (request.action === "chatError") {
    console.error("Chat error:", request.error);
    // エラーメッセージを表示するな��の処理を行う
  }
});

// 必要に応じて、UIイベントなどでsendChatMessage関数を呼び出す
// 例: document.getElementById('sendButton').addEventListener('click', () => sendChatMessage(messages, model));