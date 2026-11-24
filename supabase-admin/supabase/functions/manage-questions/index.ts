import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { decodeProtectedHeader, importX509, jwtVerify } from "jose";

// Firebase project
const FIREBASE_PROJECT_ID = "service-training-site";

// Единственный администратор
const ADMIN_EMAIL = "maxmazh48@gmail.com";

// Официальный адрес публичных сертификатов Firebase
const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

// Кэш сертификатов Google
let cachedCerts: Record<string, string> | null = null;
let certsExpiresAt = 0;

async function getFirebaseCertificates(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < certsExpiresAt) {
    return cachedCerts;
  }

  const response = await fetch(FIREBASE_CERTS_URL);

  if (!response.ok) {
    throw new Error("Не удалось получить сертификаты Firebase");
  }

  const certificates = await response.json();

  cachedCerts = certificates;

  const cacheControl = response.headers.get("Cache-Control") || "";
  const maxAge = cacheControl.match(/max-age=(\d+)/i);
  const cacheSeconds = maxAge ? Number(maxAge[1]) : 3600;

  certsExpiresAt = Date.now() + cacheSeconds * 1000;

  return certificates;
}

async function verifyFirebaseToken(token: string) {
  const header = decodeProtectedHeader(token);

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Недопустимый алгоритм или ключ токена");
  }

  let certificates = await getFirebaseCertificates();
  let certificate = certificates[header.kid];

  if (!certificate) {
    cachedCerts = null;
    certsExpiresAt = 0;

    certificates = await getFirebaseCertificates();
    certificate = certificates[header.kid];
  }

  if (!certificate) {
    throw new Error("Сертификат Firebase не найден");
  }

  const publicKey = await importX509(certificate, "RS256");

  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    audience: FIREBASE_PROJECT_ID,
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
  });

  const now = Math.floor(Date.now() / 1000);

  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0
  ) {
    throw new Error("Некорректный Firebase UID");
  }

  if (
    typeof payload.auth_time !== "number" ||
    payload.auth_time > now
  ) {
    throw new Error("Некорректное время авторизации");
  }

  if (
    typeof payload.iat !== "number" ||
    payload.iat > now
  ) {
    throw new Error("Некорректное время выдачи токена");
  }

  if (
    typeof payload.email !== "string" ||
    payload.email.toLowerCase() !== ADMIN_EMAIL
  ) {
    throw new Error("Доступ запрещён: email не администратора");
  }

  if (payload.email_verified !== true) {
    throw new Error("Email администратора не подтверждён");
  }

  return {
    uid: payload.sub,
    email: payload.email,
  };
}

// Проверка UUID
function isValidUUID(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export default {
  fetch: withSupabase(
    { auth: "none" },
    async (req, ctx) => {
      // Проверяем метод запроса
      if (req.method !== "POST") {
        return Response.json(
          { error: "Метод не поддерживается" },
          { status: 405 },
        );
      }

      // Получаем Firebase ID token
      const authorization = req.headers.get("Authorization") || "";
      const match = authorization.match(/^Bearer\s+(.+)$/i);

      if (!match) {
        return Response.json(
          { error: "Firebase ID token не передан" },
          { status: 401 },
        );
      }

      // Проверяем Firebase token
      let admin;

      try {
        admin = await verifyFirebaseToken(match[1]);
      } catch (error) {
        console.error("Firebase verification error:", error);

        return Response.json(
          { error: "Не удалось подтвердить авторизацию" },
          { status: 401 },
        );
      }

      // Получаем данные запроса
      let body;

      try {
        body = await req.json();
      } catch {
        return Response.json(
          { error: "Некорректный JSON" },
          { status: 400 },
        );
      }
      // Обработка удаления вопроса
      if (body?.action === "delete_question") {
        const { question_id } = body;
        // Проверяем ID удаляемого вопроса
        if (!isValidUUID(question_id)) {
          return Response.json(
            { error: "Некорректный ID вопроса" },
            { status: 400 },
          );
        }
        // Удаляем вопрос и все его ответы через SQL-функцию
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "admin_delete_question",
          {
            p_question_id: question_id,
          },
        );

        if (error) {
          console.error("Question delete error:", error);

          return Response.json(
            { error: "Не удалось удалить вопрос из базы данных" },
            { status: 500 },
          );
        }

        return Response.json({
          success: true,
          message: "Вопрос и варианты ответов успешно удалены",
          question_id: data,
          admin: {
            uid: admin.uid,
            email: admin.email,
          },
        });
      }

      // Обработка создания и редактирования группы
      if (body?.action === "save_group") {
        const {
          test_id,
          group_id,
          name,
          questions_per_ticket,
        } = body;
        // Проверяем ID теста
        if (!isValidUUID(test_id)) {
          return Response.json(
            { error: "Некорректный ID теста" },
            { status: 400 },
          );
        }
        // Проверяем ID группы, если она редактируется
        if (
          group_id !== null &&
          group_id !== undefined &&
          !isValidUUID(group_id)
        ) {
          return Response.json(
            { error: "Некорректный ID группы" },
            { status: 400 },
          );
        }
        // Проверяем название группы
        if (
          typeof name !== "string" ||
          name.trim().length === 0 ||
          name.length > 200
        ) {
          return Response.json(
            { error: "Некорректное название группы" },
            { status: 400 },
          );
        }
        // Проверяем количество вопросов в билете
        if (
          !Number.isInteger(questions_per_ticket) ||
          questions_per_ticket < 1
        ) {
          return Response.json(
            { error: "Количество вопросов должно быть больше нуля" },
            { status: 400 },
          );
        }
        // Сохраняем группу через SQL-функцию
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "admin_save_group",
          {
            p_test_id: test_id,
            p_name: name,
            p_questions_per_ticket: questions_per_ticket,
            p_group_id: group_id || null,
          },
        );
        if (error) {
          console.error("Group save error:", error);
          return Response.json(
            { error: "Не удалось сохранить группу" },
            { status: 500 },
          );
        }
        return Response.json({
          success: true,
          message: "Группа успешно сохранена",
          group_id: data,
          admin: {
            uid: admin.uid,
            email: admin.email,
          },
        });
      }

      // Обработка удаления группы вместе со всеми вопросами и ответами
      if (body?.action === "delete_group") {
        const { group_id } = body;

        // Проверяем ID удаляемой группы
        if (!isValidUUID(group_id)) {
          return Response.json(
            { error: "Некорректный ID группы" },
            { status: 400 },
          );
        }

        // Удаляем группу через защищённую SQL-функцию
        const { data, error } = await ctx.supabaseAdmin.rpc(
          "admin_delete_group",
          {
            p_group_id: group_id,
          },
        );

        if (error) {
          console.error("Group delete error:", error);

          return Response.json(
            { error: "Не удалось удалить группу из базы данных" },
            { status: 500 },
          );
        }

        return Response.json({
          success: true,
          message: "Группа и все её вопросы успешно удалены",
          deleted_questions: data,
          group_id: group_id,
          admin: {
            uid: admin.uid,
            email: admin.email,
          },
        });
      }

      // Проверяем тип операции сохранения
      if (body?.action !== "save_question") {
        return Response.json(
          { error: "Неизвестная операция" },
          { status: 400 },
        );
      }

      const {
        question_id,
        group_id,
        question_text,
        answers,
        sort_order,
      } = body;

      // Проверяем ID группы
      if (!isValidUUID(group_id)) {
        return Response.json(
          { error: "Некорректный ID группы" },
          { status: 400 },
        );
      }

      // Проверяем ID вопроса, если он передан
      if (question_id !== null && question_id !== undefined &&
          !isValidUUID(question_id)) {
        return Response.json(
          { error: "Некорректный ID вопроса" },
          { status: 400 },
        );
      }

      // Проверяем текст вопроса
      if (
        typeof question_text !== "string" ||
        question_text.trim().length === 0 ||
        question_text.length > 10000
      ) {
        return Response.json(
          { error: "Некорректный текст вопроса" },
          { status: 400 },
        );
      }

      // Проверяем порядок вопроса
      if (
        sort_order !== null &&
        sort_order !== undefined &&
        (!Number.isInteger(sort_order) || sort_order < 1)
      ) {
        return Response.json(
          { error: "Некорректный порядковый номер вопроса" },
          { status: 400 },
        );
      }

      // Проверяем массив ответов
      if (
        !Array.isArray(answers) ||
        answers.length < 2 ||
        answers.length > 100
      ) {
        return Response.json(
          { error: "Необходимо передать от 2 до 100 вариантов ответа" },
          { status: 400 },
        );
      }

      // Проверяем каждый ответ
      for (const answer of answers) {
        if (
          typeof answer?.answer_text !== "string" ||
          answer.answer_text.trim().length === 0 ||
          answer.answer_text.length > 5000 ||
          typeof answer.is_correct !== "boolean"
        ) {
          return Response.json(
            { error: "Некорректные данные варианта ответа" },
            { status: 400 },
          );
        }
      }

      // Проверяем количество правильных ответов
      const correctCount = answers.filter(
        (answer: { is_correct: boolean }) => answer.is_correct,
      ).length;

      if (correctCount !== 1) {
        return Response.json(
          { error: "Должен быть ровно один правильный ответ" },
          { status: 400 },
        );
      }

      // Сохраняем вопрос через защищённую SQL-функцию
      const { data, error } = await ctx.supabaseAdmin.rpc(
        "admin_save_question",
        {
          p_question_id: question_id || null,
          p_group_id: group_id,
          p_question_text: question_text,
          p_answers: answers,
          p_sort_order: sort_order ?? null,
        },
      );

      if (error) {
        console.error("Question save error:", error);

        return Response.json(
          { error: "Не удалось сохранить вопрос в базе данных" },
          { status: 500 },
        );
      }

      // Возвращаем результат
      return Response.json({
        success: true,
        message: "Вопрос успешно сохранён",
        question_id: data,
        admin: {
          uid: admin.uid,
          email: admin.email,
        },
      });
    },
  ),
};