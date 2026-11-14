const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 8080;

app.use(express.json());
app.use(express.static(__dirname));

// --- Вспомогательные функции для записи CSV ---

// Синхронная пауза (для повторов)
function sleepSync(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) { /* busy wait */ }
}

// Формирует корректную CSV-строку с экранированием
function toCsvRow(values) {
    return values.map(value => {
        const str = String(value == null ? '' : value);
        if (str.includes(';') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }).join(';');
}

// Заголовок с BOM (для Excel)
const CSV_HEADER = '\uFEFF' + 'Дата;Тест;ФИО;Орган;Баллы;Всего;Процент;Оценка;Время (сек)\n';

// Пытается дописать строку в конкретный файл. Возвращает true/false.
function tryAppend(filePath, line) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, CSV_HEADER, 'utf8');
        }
        fs.appendFileSync(filePath, line + '\n', 'utf8');
        return true;
    } catch (err) {
        if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') {
            return false; // файл занят — это ожидаемо, обработаем выше
        }
        throw err; // другая ошибка — пробрасываем
    }
}

// Основная функция: пишет в results.csv, при неудаче — в results_2.csv, results_3.csv и т.д.
function saveResultLine(line) {
    const baseName = 'results';
    const maxAttemptsPerFile = 5;
    const delayMs = 100;

    // Сначала пробуем основной файл с повторами
    const mainPath = path.join(__dirname, baseName + '.csv');
    for (let i = 0; i < maxAttemptsPerFile; i++) {
        if (tryAppend(mainPath, line)) {
            return { file: baseName + '.csv', fallback: false };
        }
        sleepSync(delayMs);
    }

    // Основной файл занят — ищем свободный резервный
    for (let n = 2; n < 1000; n++) {
        const fallbackName = baseName + '_' + n + '.csv';
        const fallbackPath = path.join(__dirname, fallbackName);
        // В резервный тоже пробуем несколько раз (на случай, если он тоже открыт)
        for (let i = 0; i < maxAttemptsPerFile; i++) {
            if (tryAppend(fallbackPath, line)) {
                return { file: fallbackName, fallback: true };
            }
            sleepSync(delayMs);
        }
    }

    // Совсем не смогли (крайне маловероятно)
    throw new Error('Не удалось записать результат ни в один CSV-файл');
}

// --- Маршрут сохранения результата ---

app.post('/api/save-result', (req, res) => {
    const result = req.body;

    if (!result || !result.fio || !result.testName) {
        return res.status(400).json({ error: 'Invalid data' });
    }

    const timestamp = new Date().toLocaleString('ru-RU');
    const line = toCsvRow([
        timestamp,
        result.testName,
        result.fio,
        result.org,
        result.score,
        result.total,
        result.percent,
        result.passed ? 'Удовлетворительно' : 'Неудовлетворительно',
        result.spentSec
    ]);

    try {
        const saved = saveResultLine(line);
        if (saved.fallback) {
            console.warn(`[${timestamp}] Основной results.csv занят. Результат записан в ${saved.file}`);
        } else {
            console.log(`[${timestamp}] Результат сохранен в ${saved.file}: ${result.fio} (${result.testName})`);
        }
        res.json({ status: 'ok', file: saved.file });
    } catch (err) {
        console.error('Ошибка записи результата:', err.message);
        res.status(500).json({ error: 'File write error' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: http://0.0.0.0:${PORT}`);
});