(function () {
  "use strict";

  var TEST_SLUG = "fire";
  var TEST_NAME_URL = "Ognevaya-podgotovka";

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

  function showError(message) {
    console.error("Ошибка загрузки теста:", message);

    document.body.innerHTML =
      '<div class="wrap">' +
        '<div class="card bad-text">' +
          '<h2>Не удалось загрузить тест</h2>' +
          '<p>' + message + '</p>' +
          '<p>Пожалуйста, обновите страницу позднее.</p>' +
        '</div>' +
      '</div>';
  }

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

  async function loadTest() {
    var supabase = await waitForSupabase();

    // Получаем тест
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

    // Получаем группы
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

    // Получаем вопросы
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

    // Получаем варианты ответов
    var questionIds = questionsData.map(function (q) {
      return q.id;
    });

    var answersResult = await supabase
      .from("answers")
      .select("id, question_id, answer_text, is_correct, sort_order")
      .in("question_id", questionIds)
      .order("sort_order", { ascending: true });

    if (answersResult.error) throw answersResult.error;

    var answersData = answersResult.data || [];

    // Готовим варианты ответов для каждого вопроса
    var answersByQuestion = {};

    answersData.forEach(function (a) {
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

    // Формируем вопросы в старом формате
    var questions = questionsData.map(function (q) {
      var answers = answersByQuestion[q.id] || [];

      if (!answers.length) {
        throw new Error("У вопроса отсутствуют варианты ответов: " + q.id);
      }

      if (answers.filter(function (a) {
        return a.Score > 0;
      }).length !== 1) {
        throw new Error("У вопроса должно быть ровно один правильный ответ: " + q.id);
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

    // Индекс вопросов по группам
    var questionsByGroup = {};

    questionsData.forEach(function (q) {
      if (!questionsByGroup[q.group_id]) {
        questionsByGroup[q.group_id] = [];
      }

      questionsByGroup[q.group_id].push(q.id);
    });

    // Формируем объект теста
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

    console.log("Тест загружен из Supabase:", {
      name: window.test.Name,
      questions: questions.length,
      groups: window.test.groups.length
    });
  }

  async function start() {
    try {
      await loadTest();

      // Запускаем старый механизм тестирования
      var script = document.createElement("script");
      script.src = "test-script.js";
      script.onerror = function () {
        showError("Не удалось загрузить test-script.js.");
      };

      document.body.appendChild(script);

    } catch (error) {
      showError(error.message || String(error));
    }
  }

  start();

})();