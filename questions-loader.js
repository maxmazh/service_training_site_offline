
(function () {
  "use strict";

  var TEST_SLUG = "fire";
  var TEST_NAME_URL = "Ognevaya-podgotovka";

  // Настройки локального хранилища
  var DB_NAME = "service-training-tests";
  var DB_VERSION = 1;
  var STORE_NAME = "tests";

  var INITIAL_PARAMETERS = [
    {
      Id: 4597587,
      ParameterType: 40,
      Name: "Фамилия Имя Отчество",
      Value1: 0,
      Value2: 0,
      Required: true,
      ToolTip: "Введите полностью ФИО, без сокращений",
      UserListItems: [],
      UrlParam: "",
      RestrictionCount: 1
    },
    {
      Id: 4597591,
      ParameterType: 110,
      Name: "Территориальный орган",
      Value1: 0,
      Value2: 0,
      Required: true,
      ToolTip: "Выберите ваш территориальный орган",
      UserListItems: [
        "по области",
        "Грязинский",
        "Задонский",
        "г. Ельцу",
        "Елецкий",
        "Тербунский",
        "Усманский",
        "Добринский",
        "Липецкий",
        "Лебедянский",
        "Данковский",
        "Чаплыгинский",
        "Становлянское",
        "Измалковское",
        "Хлевенское",
        "г. Липецку (осн)",
        "г. Липецку № 2",
        "г. Липецку № 3",
        "г. Липецку № 4",
        "г. Липецку № 6",
        "г. Липецку № 7",
        "г. Липецку № 8",
        "ППСП г. Липецку",
        "ОКПО г. Липецку",
        "ДПС г. Липецку"
      ],
      UrlParam: "",
      RestrictionCount: 0
    }
  ];

  // Показываем ошибку загрузки
  function showError(message) {
    console.error("Ошибка загрузки теста:", message);

    document.body.innerHTML =
      '<div class="wrap">' +
        '<div class="card bad-text">' +
          '<h2>Не удалось загрузить тест</h2>' +
          '<p id="load-error-message"></p>' +
          '<p>Пожалуйста, обновите страницу позднее.</p>' +
        '</div>' +
      '</div>';

    document.getElementById("load-error-message").textContent = message;
  }

  // Открываем IndexedDB
  function openCacheDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB не поддерживается браузером."));
        return;
      }

      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        var db = request.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: "slug"
          });
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };

      request.onerror = function () {
        reject(request.error || new Error("Не удалось открыть IndexedDB."));
      };

      request.onblocked = function () {
        reject(new Error("Открытие IndexedDB заблокировано."));
      };
    });
  }

  // Сохраняем данные теста в IndexedDB
  async function saveCachedData(data) {
    var db;

    try {
      db = await openCacheDB();

      await new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, "readwrite");
        var store = transaction.objectStore(STORE_NAME);

        store.put({
          slug: TEST_SLUG,
          savedAt: new Date().toISOString(),
          data: data
        });

        transaction.oncomplete = function () {
          resolve();
        };

        transaction.onerror = function () {
          reject(transaction.error);
        };

        transaction.onabort = function () {
          reject(transaction.error || new Error("Сохранение отменено."));
        };
      });

      console.log("Локальная копия теста сохранена.");
      return true;

    } catch (error) {
      console.warn("Не удалось сохранить тест в IndexedDB:", error);
      return false;

    } finally {
      if (db) db.close();
    }
  }

  // Получаем сохранённые данные из IndexedDB
  async function loadCachedData() {
    var db;

    try {
      db = await openCacheDB();

      var record = await new Promise(function (resolve, reject) {
        var transaction = db.transaction(STORE_NAME, "readonly");
        var store = transaction.objectStore(STORE_NAME);
        var request = store.get(TEST_SLUG);

        request.onsuccess = function () {
          resolve(request.result || null);
        };

        request.onerror = function () {
          reject(request.error);
        };
      });

      if (!record || !record.data) {
        return null;
      }

      console.log("Найдена локальная копия теста:", record.savedAt);

      return record.data;

    } catch (error) {
      console.warn("Не удалось прочитать IndexedDB:", error);
      return null;

    } finally {
      if (db) db.close();
    }
  }

  // Ожидаем подключения Supabase
  async function waitForSupabase() {
    for (var i = 0; i < 100; i++) {
      if (window.supabaseClient) {
        return window.supabaseClient;
      }

      await new Promise(function (resolve) {
        setTimeout(resolve, 100);
      });
    }

    throw new Error("Supabase не подключился за 10 секунд.");
  }

  // Загрузка данных из Supabase
  async function loadOnlineData() {
    var supabase = await waitForSupabase();

    var testResult = await supabase
      .from("tests")
      .select("id, slug, name, is_active")
      .eq("slug", TEST_SLUG)
      .eq("is_active", true)
      .single();

    if (testResult.error) throw testResult.error;

    var testData = testResult.data;

    if (!testData) {
      throw new Error("Тест не найден в Supabase.");
    }

    var groupsResult = await supabase
      .from("question_groups")
      .select("id, name, sort_order, questions_per_ticket")
      .eq("test_id", testData.id)
      .order("sort_order", { ascending: true });

    if (groupsResult.error) throw groupsResult.error;

    var groupsData = groupsResult.data || [];

    if (!groupsData.length) {
      throw new Error("Для теста не найдены группы вопросов.");
    }

    var groupIds = groupsData.map(function (g) {
      return g.id;
    });

    var questionsResult = await supabase
      .from("questions")
      .select("id, group_id, question_text, sort_order")
      .in("group_id", groupIds)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (questionsResult.error) throw questionsResult.error;

    var questionsData = questionsResult.data || [];

    if (!questionsData.length) {
      throw new Error("Вопросы не найдены.");
    }

    var questionIds = questionsData.map(function (q) {
      return q.id;
    });

    var answersResult = await supabase
      .from("answers")
      .select("id, question_id, answer_text, is_correct, sort_order")
      .in("question_id", questionIds)
      .order("sort_order", { ascending: true });

    if (answersResult.error) throw answersResult.error;

    return {
      test: testData,
      groups: groupsData,
      questions: questionsData,
      answers: answersResult.data || []
    };
  }

  // Загрузка данных из JSON
  async function loadOfflineData() {
    var response = await fetch("tests-export.json", {
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        "Не удалось загрузить tests-export.json. HTTP " + response.status
      );
    }

    var exportData = await response.json();

    if (
      exportData.format_version !== 1 ||
      !Array.isArray(exportData.tests)
    ) {
      throw new Error("Неверный формат файла tests-export.json.");
    }

    var testData = exportData.tests.find(function (test) {
      return test.slug === TEST_SLUG && test.is_active === true;
    });

    if (!testData) {
      throw new Error("Активный тест " + TEST_SLUG + " не найден в JSON.");
    }

    var groupsData = [];
    var questionsData = [];
    var answersData = [];

    (testData.groups || []).forEach(function (group) {
      groupsData.push({
        id: group.id,
        name: group.name,
        sort_order: group.sort_order,
        questions_per_ticket: group.questions_per_ticket
      });

      (group.questions || []).forEach(function (question) {
        if (question.is_active !== true) {
          return;
        }

        questionsData.push({
          id: question.id,
          group_id: group.id,
          question_text: question.question_text,
          sort_order: question.sort_order
        });

        (question.answers || []).forEach(function (answer) {
          answersData.push({
            id: answer.id,
            question_id: question.id,
            answer_text: answer.answer_text,
            is_correct: answer.is_correct,
            sort_order: answer.sort_order
          });
        });
      });
    });

    if (!groupsData.length) {
      throw new Error("В JSON не найдены группы вопросов.");
    }

    return {
      test: testData,
      groups: groupsData,
      questions: questionsData,
      answers: answersData
    };
  }

  // Общая проверка и преобразование данных
  function buildTest(data) {
    var testData = data.test;

    var groupsData = data.groups.slice().sort(function (a, b) {
      return a.sort_order - b.sort_order;
    });

    var questionsData = data.questions.slice().sort(function (a, b) {
      return a.sort_order - b.sort_order;
    });

    var answersByQuestion = {};

    data.answers.forEach(function (a) {
      if (!answersByQuestion[a.question_id]) {
        answersByQuestion[a.question_id] = [];
      }

      answersByQuestion[a.question_id].push({
        Id: a.id,
        Text: a.answer_text,
        TextWOHtml: a.answer_text.replace(/<[^>]*>/g, ""),
        Score: a.is_correct ? 1 : 0,
        IsRightAnswer: a.is_correct
      });
    });

    var questions = questionsData.map(function (q) {
      var answers = answersByQuestion[q.id] || [];

      if (!answers.length) {
        throw new Error(
          "У вопроса отсутствуют варианты ответов: " + q.id
        );
      }

      if (
        answers.filter(function (a) {
          return a.Score > 0;
        }).length !== 1
      ) {
        throw new Error(
          "У вопроса должно быть ровно один правильный ответ: " + q.id
        );
      }

      return {
        Id: q.id,
        Number: q.sort_order,
        QuestionType: 10,
        Text: q.question_text,
        AnswerType: 10,
        AnswerTemplates: answers,
        RandomAnswersSequence: false
      };
    });

    if (!questions.length) {
      throw new Error("В тесте отсутствуют активные вопросы.");
    }

    var questionsByGroup = {};

    questionsData.forEach(function (q) {
      if (!questionsByGroup[q.group_id]) {
        questionsByGroup[q.group_id] = [];
      }

      questionsByGroup[q.group_id].push(q.id);
    });

    window.test = {
      Name: testData.name,
      NameUrl: TEST_NAME_URL,
      Params: {
        timelimited: true,
        timelimitminutes: 20,
        timelimitseconds: 0
      },
      InitialParameters: INITIAL_PARAMETERS,
      Questions: questions,
      groups: groupsData.map(function (g) {
        return {
          id: g.id,
          name: g.name,
          questions: questionsByGroup[g.id] || [],
          isRandomQuestions: true,
          isLimitedQuestions: true,
          limitedQuestionsCount: g.questions_per_ticket
        };
      }),
      IsRandomQuestions: false,
      IsRandomAnswersInAllQuestions: true,
      IsLimitedQuestions: false,
      LimitedQuestionsCount: 20
    };

    return {
      name: window.test.Name,
      questions: questions.length,
      groups: window.test.groups.length
    };
  }

  // Обновляем локальную копию в фоновом режиме
  async function refreshCacheInBackground() {
    try {
      var freshData = await loadOnlineData();

      await saveCachedData(freshData);

      console.log("Локальная копия теста обновлена из Supabase.");

    } catch (error) {
      console.warn(
        "Не удалось обновить локальную копию. Оставляем сохранённые данные:",
        error
      );
    }
  }

  // Подключаем старый механизм тестирования
  function launchTest() {
    var script = document.createElement("script");

    script.src = "test-script.js";

    script.onerror = function () {
      showError("Не удалось загрузить test-script.js.");
    };

    document.body.appendChild(script);
  }

  // Запуск теста
  async function start() {
    var data = null;
    var result = null;
    var source = "";
    var refreshInBackground = false;

    // 1. Сначала пробуем JSON
    try {
      var jsonData = await loadOfflineData();
      var jsonResult = buildTest(jsonData);

      data = jsonData;
      result = jsonResult;
      source = "JSON";

      await saveCachedData(data);

    } catch (jsonError) {
      console.warn(
        "JSON недоступен или содержит ошибку. Проверяем IndexedDB:",
        jsonError
      );
    }

    // 2. Если JSON недоступен, проверяем IndexedDB
    if (!data) {
      var cachedData = await loadCachedData();

      if (cachedData) {
        try {
          var cachedResult = buildTest(cachedData);

          data = cachedData;
          result = cachedResult;
          source = "IndexedDB";
          refreshInBackground = true;

        } catch (cacheError) {
          console.warn(
            "Сохранённая копия повреждена. Пробуем Supabase:",
            cacheError
          );
        }
      }
    }

    // 3. Если локальных данных нет, обращаемся к Supabase
    if (!data) {
      try {
        var onlineData = await loadOnlineData();
        var onlineResult = buildTest(onlineData);

        data = onlineData;
        result = onlineResult;
        source = "Supabase";

        await saveCachedData(data);

      } catch (onlineError) {
        throw new Error(
          "Не удалось загрузить тест ни из локальных источников, " +
          "ни из Supabase. " + (onlineError.message || String(onlineError))
        );
      }
    }

    console.log("Тест успешно загружен:", {
      source: source,
      name: result.name,
      questions: result.questions,
      groups: result.groups
    });

    // Если использовали IndexedDB, обновляем её в фоне
    if (refreshInBackground) {
      refreshCacheInBackground();
    }

    launchTest();
  }

  start().catch(function (error) {
    showError(error.message || String(error));
  });

})();
