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

// Простой парсер CSV (с учётом кавычек и ; как разделителя)
function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') { current += '"'; i++; }
                else { inQuotes = false; }
            } else { current += ch; }
        } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ';') { result.push(current); current = ''; }
            else { current += ch; }
        }
    }
    result.push(current);
    return result;
}

function readAllResults() {
    const dir = __dirname;
    // Собираем все results.csv и results_N.csv
    const files = fs.readdirSync(dir)
        .filter(f => /^results(_\d+)?\.csv$/.test(f))
        .sort((a, b) => {
            // results.csv первым, потом по номеру
            const na = a.match(/_(\d+)/); const nb = b.match(/_(\d+)/);
            const va = na ? parseInt(na[1]) : 0;
            const vb = nb ? parseInt(nb[1]) : 0;
            return va - vb;
        });

    const rows = [];
    for (const file of files) {
        let content;
        try {
            content = fs.readFileSync(path.join(dir, file), 'utf8');
        } catch (e) {
            continue; // файл занят — пропускаем, покажем что есть
        }
        // убираем BOM
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
        const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
        // первая строка — заголовок, пропускаем
        for (let i = 1; i < lines.length; i++) {
            const cols = parseCsvLine(lines[i]);
            if (cols.length < 9) continue;
            rows.push({
                date: cols[0],
                test: cols[1],
                fio: cols[2],
                org: cols[3],
                score: Number(cols[4]) || 0,
                total: Number(cols[5]) || 0,
                percent: Number(cols[6]) || 0,
                verdict: cols[7],
                spentSec: Number(cols[8]) || 0,
                sourceFile: file
            });
        }
    }
    return rows;
}

app.get('/api/results', (req, res) => {
    try {
        const rows = readAllResults();
        // Сортируем по дате (по убыванию — свежие сверху).
        // Даты в формате ru-RU ("14.11.2026, 14:30:00") — парсим вручную.
        function parseRuDate(s) {
            // "14.11.2026, 14:30:00" → Date
            const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
            if (!m) return new Date(0);
            return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +m[6]);
        }
        rows.sort((a, b) => parseRuDate(b.date) - parseRuDate(a.date));
        res.json(rows);
    } catch (e) {
        console.error('Ошибка чтения результатов:', e.message);
        res.status(500).json({ error: 'Read error' });
    }
});

// Скачивание объединённого CSV (свежие сверху, с BOM для Excel)
app.get('/api/results.csv', (req, res) => {
    try {
        const rows = readAllResults();
        const header = '\uFEFF' + 'Дата;Тест;ФИО;Орган;Баллы;Всего;Процент;Оценка;Время (сек)\n';
        const body = rows.map(r => toCsvRow([
            r.date, r.test, r.fio, r.org,
            r.score, r.total, r.percent, r.verdict, r.spentSec
        ])).join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="results_all.csv"');
        res.send(header + body);
    } catch (e) {
        res.status(500).send('Read error');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Сервер запущен: http://0.0.0.0:${PORT}`);
});