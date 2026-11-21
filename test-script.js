(function () {
  "use strict";

  // ====== КОНСТАНТЫ ======
  var LIMIT_MINUTES = (window.test && test.Params && test.Params.timelimited)
    ? test.Params.timelimitminutes : 20;
  var LIMIT_SECONDS = LIMIT_MINUTES * 60;
  var PASS_PERCENT = 80;
  var TEST_KEY = (window.test && test.NameUrl) ? test.NameUrl : "test";
  var STORAGE_RESULTS = "otp_results_" + TEST_KEY;
  var STORAGE_SESSION = "otp_session_" + TEST_KEY;
  var STORAGE_PENDING = "otp_pending_" + TEST_KEY;

  // ====== СОСТОЯНИЕ ======
  var state = {
    questions: [],
    answers: {},
    currentIndex: 0,
    fio: "",
    org: "",
    startedAt: 0,
    deadline: 0,
    timerId: null,
    isFinishing: false
  };

  // ====== УТИЛИТЫ ======
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function stripHtml(s) {
    var d = document.createElement("div");
    d.innerHTML = s || "";
    return d.textContent || d.innerText || "";
  }
  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
  }
  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600),
        m = Math.floor((sec - h * 3600) / 60),
        s = sec % 60;
    return (h ? h + " ч " : "") + pad(m) + ":" + pad(s);
  }

  // ====== ВЫБОР ВОПРОСОВ (3 + 9 + 8 = 20) ======
  function buildQuestions() {
    if (!window.test || !test.Questions) return [];
    var byId = {};
    test.Questions.forEach(function (q) { byId[q.Id] = q; });
    var chosen = [];
    var used = {};
    (test.groups || []).forEach(function (g) {
      var pool = [];
      (g.questions || []).forEach(function (qid) {
        if (byId[qid] && !used[qid]) pool.push(byId[qid]);
      });
      if (g.isRandomQuestions) shuffle(pool);
      var take = g.isLimitedQuestions
        ? Math.min(g.limitedQuestionsCount, pool.length)
        : pool.length;
      pool.slice(0, take).forEach(function (q) {
        chosen.push(q);
        used[q.Id] = true;
      });
    });
    var total = test.LimitedQuestionsCount || 20;
    if (test.IsLimitedQuestions && chosen.length < total) {
      var rest = test.Questions.filter(function (q) { return !used[q.Id]; });
      shuffle(rest);
      rest.slice(0, total - chosen.length).forEach(function (q) {
        chosen.push(q);
        used[q.Id] = true;
      });
    }
    if (test.IsRandomQuestions) shuffle(chosen);
    chosen.forEach(function (q) {
      if ((test.IsRandomAnswersInAllQuestions || q.RandomAnswersSequence) &&
          q.AnswerTemplates && q.AnswerTemplates.length > 1 &&
          [410, 420, 430, 450, 460].indexOf(q.AnswerType) === -1) {
        shuffle(q.AnswerTemplates);
      }
    });
    chosen.forEach(function (q, i) { q.Number = i + 1; });
    return chosen;
  }

  // ====== ЭКРАНЫ ======
  function showScreen(id) {
    ["screen-reg", "screen-test", "screen-result"].forEach(function (s) {
      $(s).classList.toggle("hidden", s !== id);
    });
  }

  // ====== РЕГИСТРАЦИЯ ======
  function initRegScreen() {
    $("test-title").textContent = test.Name || "Тест";
    var orgSel = $("org");
    orgSel.innerHTML = '<option value="">— выберите —</option>';
    var regParam = (test.InitialParameters || []).find(function (p) {
      return p.ParameterType === 110;
    });
    if (regParam && regParam.UserListItems) {
      regParam.UserListItems.forEach(function (v) {
        var o = document.createElement("option");
        o.value = v;
        o.textContent = v;
        orgSel.appendChild(o);
      });
    }
  }

  function startTest() {
    var fio = $("fio").value.trim();
    var org = $("org").value;
    var err = $("reg-error");
    err.textContent = "";
    if (fio.length < 3) { err.textContent = "Введите ФИО полностью."; return; }
    if (!org) { err.textContent = "Выберите территориальный орган."; return; }

    state.fio = fio;
    state.org = org;
    state.questions = buildQuestions();
    state.answers = {};
    state.currentIndex = 0;
    state.startedAt = Date.now();
    state.deadline = state.startedAt + LIMIT_SECONDS * 1000;

    saveSession();
    showScreen("screen-test");
    $("t-user").textContent = state.fio;
    $("t-org").textContent = state.org;
    $("q-total").textContent = state.questions.length;
    renderCurrentQuestion();
    startTimer();
  }

  // ====== ОТРИСОВКА ТЕКУЩЕГО ВОПРОСА ======
  function renderCurrentQuestion() {
    var total = state.questions.length;
    var idx = state.currentIndex;
    var q = state.questions[idx];
    // Счётчик и прогресс
    $("q-current").textContent = idx + 1;
    $("progress-fill").style.width = Math.round((idx + 1) / total * 100) + "%";
    // Хост вопроса
    var host = $("question-host");
    host.innerHTML = "";
    var div = document.createElement("div");
    div.className = "q";
    var html = '<div class="q-text">' +
      q.Number + ". " + escapeHtml(stripHtml(q.Text || "")) +
      "</div>";
    var chosenId = state.answers[q.Id];
    (q.AnswerTemplates || []).forEach(function (a) {
      var checked = chosenId === a.Id;
      html +=
        '<label class="ans' + (checked ? " selected" : "") + '" data-aid="' + a.Id + '">' +
          '<input type="radio" name="q' + q.Id + '" value="' + a.Id + '"' +
            (checked ? " checked" : "") + ">" +
          escapeHtml(stripHtml(a.Text || "")) +
        "</label>";
    });
    div.innerHTML = html;
    host.appendChild(div);
    div.querySelectorAll('input[type="radio"]').forEach(function (inp) {
      inp.addEventListener("change", function () {
        state.answers[q.Id] = Number(inp.value);
        div.querySelectorAll(".ans").forEach(function (l) { l.classList.remove("selected"); });
        inp.closest(".ans").classList.add("selected");
        saveSession();
      });
    });
    // Кнопки
    $("btn-prev").disabled = idx === 0;
    var isLast = idx === total - 1;
    $("btn-next").classList.toggle("hidden", isLast);
    $("btn-finish").classList.toggle("hidden", !isLast);
    // Автоскролл наверх страницы
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("test-error").textContent = "";
  }

  // ====== НАВИГАЦИЯ ======
  function goPrev() {
    if (state.currentIndex > 0) {
      state.currentIndex--;
      renderCurrentQuestion();
      saveSession();
    }
  }

  function goNext() {
    var q = state.questions[state.currentIndex];
    if (state.answers[q.Id] == null) {
      $("test-error").textContent = "Выберите вариант ответа, чтобы продолжить.";
      return;
    }
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex++;
      renderCurrentQuestion();
      saveSession();
    }
  }

  // ====== ТАЙМЕР ======
  function saveSession() {
    try {
      localStorage.setItem(STORAGE_SESSION, JSON.stringify({
        fio: state.fio,
        org: state.org,
        startedAt: state.startedAt,
        deadline: state.deadline,
        currentIndex: state.currentIndex,
        questions: state.questions.map(function (q) { return q.Id; }),
        answers: state.answers
      }));
    } catch (e) {}
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(STORAGE_SESSION);
      if (!raw) return false;
      var s = JSON.parse(raw);
      if (!s || !s.deadline) return false;
      if (Date.now() >= s.deadline) {
        localStorage.removeItem(STORAGE_SESSION);
        return false;
      }
      var byId = {};
      (test.Questions || []).forEach(function (q) { byId[q.Id] = q; });
      var qs = (s.questions || []).map(function (id) { return byId[id]; }).filter(Boolean);
      if (qs.length === 0) { localStorage.removeItem(STORAGE_SESSION); return false; }
      qs.forEach(function (q, i) { q.Number = i + 1; });

      state.fio = s.fio;
      state.org = s.org;
      state.startedAt = s.startedAt;
      state.deadline = s.deadline;
      state.questions = qs;
      state.answers = s.answers || {};
      state.currentIndex = Math.min(Math.max(0, s.currentIndex || 0), qs.length - 1);
      return true;
    } catch (e) { return false; }
  }

  function startTimer() {
    stopTimer();
    function tick() {
      var left = Math.round((state.deadline - Date.now()) / 1000);
      var el = $("timer");
      if (left <= 0) {
        el.textContent = "00:00";
        stopTimer();
        finishTest(true);
        return;
      }
      el.textContent = fmtTime(left);
      el.classList.toggle("ok", left > 300);
      el.classList.toggle("timer", left <= 300);
    }
    tick();
    state.timerId = setInterval(tick, 500);
  }

  function stopTimer() {
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  }

  // ====== ЗАВЕРШЕНИЕ ======
  function finishTest(timeUp) {
    // Защита от повторного вызова
    if (state.isFinishing) return;
    state.isFinishing = true;
    // Блокируем кнопку «Завершить» (и на всякий случай «Далее»)
    var btnFinish = $("btn-finish");
    if (btnFinish) { btnFinish.disabled = true; btnFinish.textContent = "Отправка..."; }
    var btnNext = $("btn-next");
    if (btnNext) btnNext.disabled = true;
    if (!timeUp) {
      var unanswered = state.questions.filter(function (q) {
        return state.answers[q.Id] == null;
      });
      if (unanswered.length > 0) {
        $("test-error").textContent =
          "Выберите вариант ответа, чтобы завершить тест.";
        // Разблокируем, раз завершение не состоялось
        state.isFinishing = false;
        if (btnFinish) { btnFinish.disabled = false; btnFinish.textContent = "Завершить тест"; }
        if (btnNext) btnNext.disabled = false;
        return;
      }
    }
    stopTimer();
    var score = 0;
    var details = state.questions.map(function (q) {
      var chosenId = state.answers[q.Id];
      var rightIds = (q.AnswerTemplates || [])
        .filter(function (a) { return a.Score > 0; })
        .map(function (a) { return a.Id; });
      var isRight = chosenId != null && rightIds.indexOf(chosenId) !== -1;
      if (isRight) score++;
      return {
        number: q.Number,
        text: stripHtml(q.Text || ""),
        chosenId: chosenId,
        rightIds: rightIds,
        isRight: isRight,
        answers: (q.AnswerTemplates || []).map(function (a) {
          return { id: a.Id, text: stripHtml(a.Text || ""), score: a.Score };
        })
      };
    });
    var total = state.questions.length;
    var percent = total > 0 ? Math.round(score / total * 100) : 0;
    var passed = percent >= PASS_PERCENT;
    var finishedAt = Date.now();
    var spentSec = Math.round((finishedAt - state.startedAt) / 1000);
    var record = {
      fio: state.fio,
      org: state.org,
      score: score,
      total: total,
      percent: percent,
      passed: passed,
      startedAt: new Date(state.startedAt).toISOString(),
      finishedAt: new Date(finishedAt).toISOString(),
      spentSec: spentSec,
      timeUp: !!timeUp,
      details: details
    };
    var resultForCloud = {
      testName: test.Name || 'Неизвестный тест',
      fio: record.fio,
      org: record.org,
      score: record.score,
      total: record.total,
      percent: record.percent,
      passed: record.passed,
      spentSec: record.spentSec,
    };
    saveCompletedResult(resultForCloud, record);
  }
  // ====== ВЫБОР ХРАНИЛИЩА РЕЗУЛЬТАТОВ ======
  // Проверяем доступность локального Node.js-сервера
  function checkLocalServer() {
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 3000);
    return fetch("/api/health", {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    })
      .then(function (response) {
        if (!response.ok) return false;
        return response.json().then(function (data) {
          return data && data.status === "ok";
        });
      })
      .catch(function () {
        return false;
      })
      .then(function (available) {
        clearTimeout(timeoutId);
        return available;
      });
  }

  // Отправляем результат на локальный сервер
  function sendResultToLocalServer(payload) {
    return fetch("/api/save-result", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        return response.json().catch(function () {
          return {};
        }).then(function (data) {
          if (!response.ok || data.status !== "ok") {
            throw new Error(data.error || "Ошибка записи CSV");
          }
          return data;
        });
      });
  }

  // Определяем, куда сохранять результат
  function saveCompletedResult(payload, record) {
    checkLocalServer().then(function (localAvailable) {
      // Вариант 1. Локальный сервер доступен
      if (localAvailable) {
        sendResultToLocalServer(payload)
          .then(function (result) {
            console.log(
              "Результат сохранен на локальном сервере:",
              result.file
            );
            localStorage.removeItem(STORAGE_SESSION);
            showResult(record);
          })
          .catch(function (error) {
            console.error(
              "Ошибка сохранения на локальном сервере:",
              error
            );
            // Пытаемся сохранить резервную копию в браузере
            var backupSaved = saveResult(record);
            localStorage.removeItem(STORAGE_SESSION);
            showResult(record);
            alert(
              backupSaved
                ? "Не удалось сохранить результат на ноутбуке. " +
                  "Резервная копия сохранена в браузере этого устройства. " +
                  "Воспользуйтесь кнопкой экспорта CSV."
                : "Не удалось сохранить результат на ноутбуке " +
                  "и в браузере. Сообщите администратору."
            );
          });
        return;
      }
      // Вариант 2. Локальный сервер недоступен — используем Firebase
      try {
        addToPendingResults(payload, record);
        var savedLocally = saveResult(record);
        if (!savedLocally) {
          throw new Error("Не удалось сохранить резервную копию в браузере");
        }
        localStorage.removeItem(STORAGE_SESSION);
        showResult(record);
        syncPendingResults();
      } catch (error) {
        console.error(
          "Ошибка сохранения результата:",
          error
        );
        showResult(record);
        alert(
          "Не удалось сохранить результат. " +
          "Пожалуйста, сообщите администратору."
        );
      }
    });
  }


  function addToPendingResults(payload, record) {
    var pending = [];
    try {
      pending = JSON.parse(
        localStorage.getItem(STORAGE_PENDING) || "[]"
      );
    } catch (e) {
      pending = [];
    }
    var item = {
      id: generateResultId(),
      payload: payload,
      record: record
    };
    pending.push(item);
    localStorage.setItem(
      STORAGE_PENDING,
      JSON.stringify(pending)
    );
    return item;
  }

  function generateResultId() {
    if (window.crypto && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Date.now() + "_" +
      Math.random().toString(36).slice(2);
  }
  // Очистка localStorage после успешного сохранения в облако
  function clearLocalAfterSuccess() {
    try {
      localStorage.removeItem(STORAGE_SESSION);
      localStorage.removeItem(STORAGE_RESULTS);
    } catch (e) {}
  }
  // Удаляет конкретный результат из localStorage (по совпадению полей)
  function removeFromLocalResults(record) {
    try {
      var arr = loadResults();
      var idx = arr.findIndex(function(r) {
        return r.fio === record.fio &&
              r.startedAt === record.startedAt &&
              r.score === record.score;
      });
      if (idx !== -1) {
        arr.splice(idx, 1);
      }
      if (arr.length === 0) {
        localStorage.removeItem(STORAGE_RESULTS);
      } else {
        localStorage.setItem(
          STORAGE_RESULTS,
          JSON.stringify(arr)
        );
      }
    } catch (e) {
      console.error("Ошибка удаления локального результата:", e);
    }
  }

  function getPendingResults() {
    try {
      return JSON.parse(
        localStorage.getItem(STORAGE_PENDING) || "[]"
      );
    } catch (e) {
      return [];
    }
  }

  function removePendingResult(id) {
    var pending = getPendingResults();
    pending = pending.filter(function(item) {
      return item.id !== id;
    });
    if (pending.length === 0) {
      localStorage.removeItem(STORAGE_PENDING);
    } else {
      localStorage.setItem(
        STORAGE_PENDING,
        JSON.stringify(pending)
      );
    }
  }

  function syncPendingResults() {
    if (!navigator.onLine || !window.firestoreApi) {
      return;
    }
    var api = window.firestoreApi;
    var pending = getPendingResults();
    pending.forEach(function(item) {
      var resultRef = api.doc(api.db, "results", item.id);
      api.setDoc(resultRef, Object.assign({}, item.payload, {
        timestamp: api.serverTimestamp()
      }))
        .then(function() {
          console.log(
            "Результат успешно отправлен:",
            item.id
          );
          // Удаляем из очереди только после подтверждения сервера
          removePendingResult(item.id);
          // Удаляем локальную копию результата
          removeFromLocalResults(item.record);
        })
        .catch(function(error) {
          console.warn(
            "Не удалось отправить результат:",
            error
          );
        });
    });
  }

  // ====== РЕЗУЛЬТАТЫ ======
  function loadResults() {
    try { return JSON.parse(localStorage.getItem(STORAGE_RESULTS) || "[]"); }
    catch (e) { return []; }
  }

  function saveResult(rec) {
    var arr = loadResults();
    arr.push(rec);
    try {
      localStorage.setItem(STORAGE_RESULTS, JSON.stringify(arr));
      return true;
    } catch (e) {
      console.error("Ошибка сохранения в localStorage:", e);
      return false;
    }
  }

  function showResult(rec) {
    showScreen("screen-result");
    var verdict = rec.passed
      ? '<div class="verdict ok-text">Удовлетворительно</div>'
      : '<div class="verdict bad-text">Неудовлетворительно</div>';
    // Класс для шкалы и подписи
    var scaleClass = rec.passed ? "good" : "bad";
    var scaleLabel = rec.passed ? "удовлетворительно" : "неудовлетворительно";
    var html =
      // --- Шкала результата ---
      '<div class="score-scale">' +
        '<div class="score-scale__labels"><span>0%</span><span>100%</span></div>' +
        '<div class="score-scale__track">' +
          '<div class="score-scale__fill ' + scaleClass + '" style="width:' + rec.percent + '%"></div>' +
          '<div class="score-scale__threshold"></div>' +
        '</div>' +
        '<div class="score-scale__value ' + scaleClass + '">' +
          rec.percent + '% — ' + scaleLabel +
        '</div>' +
      '</div>' +
      // --- Блок с цифрами ---
      '<div class="result-grid">' +
        '<div><div class="muted">Правильных ответов</div>' +
          '<div class="result-big">' + rec.score + " / " + rec.total + "</div></div>" +
        '<div><div class="muted">Процент</div>' +
          '<div class="result-big">' + rec.percent + "%</div></div>" +
        "<div>" + verdict + "</div>" +
      "</div>" +
      // --- Информация о тесте ---
      '<div class="muted_inf" style="margin-top:12px">' +
        "ФИО: " + escapeHtml(rec.fio) + "<br>" +
        "Орган: " + escapeHtml(rec.org) + "<br>" +
        "Начало: " + new Date(rec.startedAt).toLocaleString() + "<br>" +
        "Окончание: " + new Date(rec.finishedAt).toLocaleString() + "<br>" +
        "Потрачено: " + fmtDuration(rec.spentSec) +
        (rec.timeUp ? " (время вышло)" : "") + "<br>" + "<br>" +
          '<div class="muted_inf2">' +
            "Удовлетворительно, если набрали 80% и более" + "<br>" +
            "Неудовлетворительно, если менее 80%" +
          "</div>" +
      "</div>";
    // --- Разбор ответов ---
    html += '<details style="margin-top:16px"><summary style="cursor:pointer; border-bottom: ridge; color: #666;">Показать мои ответы</summary>';
    rec.details.forEach(function (d) {
      html += '<div class="q"><div class="q-text">' + d.number + ". " + escapeHtml(d.text) + "</div>";
      d.answers.forEach(function (a) {
        var cls = "ans";
        if (d.rightIds.indexOf(a.id) !== -1) cls += " correct";
        else if (d.chosenId === a.id) cls += " wrong";
        html += '<div class="' + cls + '">' + escapeHtml(a.text) + "</div>";
      });
      html += "</div>";
    });
    html += "</details>";
    $("result-body").innerHTML = html;
  }

  function exportCsv() {
    var arr = loadResults();
    var rows = [["#", "ФИО", "Орган", "Баллы", "Всего", "Процент", "Оценка", "Начало", "Окончание", "Потрачено (сек)"]];
    arr.forEach(function (r, i) {
      rows.push([
        i + 1, r.fio, r.org, r.score, r.total, r.percent,
        r.passed ? "удовлетворительно" : "неудовлетворительно",
        new Date(r.startedAt).toLocaleString(),
        new Date(r.finishedAt).toLocaleString(),
        r.spentSec
      ]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (c) {
        var s = String(c == null ? "" : c).replace(/"/g, '""');
        return '"' + s + '"';
      }).join(";");
    }).join("\r\n");
    var blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "results_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

    // ====== ИНИЦИАЛИЗАЦИЯ ======
  function init() {
    if (!window.test) {
      document.body.innerHTML =
        '<div class="wrap"><div class="card bad-text">Не найден файл test.js.</div></div>';
      return;
    }
    initRegScreen();
    // Безопасное навешивание обработчика: если элемента нет — не падаем
    function bind(id, handler) {
      var el = $(id);
      if (el) el.onclick = handler;
    }
    bind("btn-start", startTest);
    bind("btn-prev", goPrev);
    bind("btn-next", goNext);
    bind("btn-finish", function () { finishTest(false); });
    bind("btn-again", function () {
      try { localStorage.removeItem(STORAGE_SESSION); } catch (e) {}
      location.reload();
    });
    // bind("btn-view-results", showList);
    bind("btn-back", function () {
      showScreen("screen-result");
    });
    bind("btn-export", exportCsv);
    // Восстановление сессии — выполняется в любом случае,
    // даже если каких-то кнопок нет на странице
    if (loadSession()) {
      showScreen("screen-test");
      $("t-user").textContent = state.fio;
      $("t-org").textContent = state.org;
      $("q-total").textContent = state.questions.length;
      renderCurrentQuestion();
      startTimer();
    }
  }

  window.addEventListener("online", function() {
    console.log("Интернет восстановлен. Отправляем результаты...");
    syncPendingResults();
  });

  window.addEventListener("load", function() {
    syncPendingResults();
  });

  document.addEventListener("DOMContentLoaded", init);
})();