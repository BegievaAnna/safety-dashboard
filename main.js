(function () {
    'use strict';

    // ─────────────────────────────────────────────
    //  Тема оформления (светлая / тёмная)
    // ─────────────────────────────────────────────
    const THEME_KEY = 'dashboard-theme';
    const htmlEl = document.documentElement;
    const themeToggleBtn = document.getElementById('themeToggle');

    function applyTheme(theme) {
        htmlEl.setAttribute('data-theme', theme);
        try {
            localStorage.setItem(THEME_KEY, theme);
        } catch (e) {
            /* localStorage может быть недоступен — просто игнорируем */
        }
    }

    function initTheme() {
        let saved = null;
        try {
            saved = localStorage.getItem(THEME_KEY);
        } catch (e) {
            saved = null;
        }

        if (saved === 'light' || saved === 'dark') {
            applyTheme(saved);
            return;
        }

        // Если пользователь ещё не выбирал — смотрим системную настройку
        const prefersLight = window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: light)').matches;
        applyTheme(prefersLight ? 'light' : 'dark');
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', function () {
            const current = htmlEl.getAttribute('data-theme') || 'dark';
            applyTheme(current === 'dark' ? 'light' : 'dark');
        });
    }

    initTheme();

    // ─────────────────────────────────────────────
    //  Конфигурация wttr.in
    // ─────────────────────────────────────────────
    const CONFIG = {
        // Координаты Выборгского района Санкт-Петербурга
        latitude: 60.0566,
        longitude: 30.3662,
        // Язык описаний погоды
        lang: 'ru',
        // Базовый адрес сервиса
        apiBase: 'https://wttr.in'
    };

    // ── DOM-элементы ──
    const els = {
        refreshBtn: document.getElementById('refreshBtn'),
        refreshIcon: document.getElementById('refreshIcon'),
        loadingMsg: document.getElementById('loadingMsg'),
        errorMsg: document.getElementById('errorMsg'),
        errorText: document.getElementById('errorText'),
        emptyMsg: document.getElementById('emptyMsg'),
        retryBtn: document.getElementById('retryBtn'),
        tempValue: document.getElementById('tempValue'),
        windValue: document.getElementById('windValue'),
        precipValue: document.getElementById('precipValue'),
        dataTime: document.getElementById('dataTime'),
        loadTime: document.getElementById('loadTime')
    };

    let isFetching = false;

    // ── Утилиты ──
    function formatDateTime(isoString) {
        if (!isoString) return '—';
        try {
            return new Date(isoString).toLocaleString('ru-RU', {
                day: 'numeric', month: 'long', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {
            return isoString;
        }
    }

    function setWidgetValue(el, value, unit) {
        if (!el) return;
        if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) {
            el.innerHTML = '—<span class="widget-unit">' + unit + '</span>';
            return;
        }
        const num = Number(value);
        const formatted = num % 1 === 0 ? num.toString() : num.toFixed(1);
        el.innerHTML = formatted + '<span class="widget-unit">' + unit + '</span>';
    }

    function show(el) { if (el) el.classList.add('visible'); }
    function hide(el) { if (el) el.classList.remove('visible'); }

    function showError(message) {
        if (els.errorText) els.errorText.textContent = message || 'Не удалось загрузить данные.';
        show(els.errorMsg);
        hide(els.loadingMsg);
        hide(els.emptyMsg);
    }

    function hideAllStatus() {
        hide(els.loadingMsg);
        hide(els.errorMsg);
        hide(els.emptyMsg);
    }

    // ─────────────────────────────────────────────
    //  Разбор ответа wttr.in
    // ─────────────────────────────────────────────
    function parseWeather(data) {
        if (!data || !Array.isArray(data.current_condition) || !data.current_condition.length) {
            return null;
        }

        const current = data.current_condition[0];

        // Безопасно достаём описание погоды (массив объектов)
        let description = '';
        if (Array.isArray(current.weatherDesc) && current.weatherDesc.length) {
            description = current.weatherDesc[0].value || '';
        }

        // Безопасно достаём название ближайшего населённого пункта
        let areaName = '';
        if (Array.isArray(data.nearest_area) && data.nearest_area.length) {
            const area = data.nearest_area[0];
            if (Array.isArray(area.areaName) && area.areaName.length) {
                areaName = area.areaName[0].value || '';
            }
        }

        return {
            temperature: current.temp_C,
            windSpeed: current.windspeedKmph,
            precipitation: current.precipMM,
            description: description,
            areaName: areaName,
            // wttr.in отдаёт localObsDateTime — время наблюдения
            observedAt: current.localObsDateTime || current.observation_time || ''
        };
    }

    // ─────────────────────────────────────────────
    //  Запрос данных о погоде
    // ─────────────────────────────────────────────
    async function fetchWeather() {
        if (isFetching) return;
        isFetching = true;

        if (els.refreshBtn) els.refreshBtn.disabled = true;
        if (els.refreshIcon) els.refreshIcon.classList.add('spin');
        hideAllStatus();
        show(els.loadingMsg);

        // Формируем URL: координаты в пути + формат + язык
        const location = CONFIG.latitude + ',' + CONFIG.longitude;
        const url = CONFIG.apiBase + '/' + encodeURIComponent(location) +
                    '?format=j1&lang=' + CONFIG.lang;

        console.log('[Dashboard] Запрос к wttr.in:', url);

        try {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error('HTTP ' + response.status + ': ' + response.statusText);
            }

            // wttr.in иногда возвращает 200 с текстом ошибки вместо JSON.
            // Читаем как текст и пробуем распарсить.
            const raw = await response.text();
            console.log('[Dashboard] Сырой ответ:', raw.slice(0, 300));

            let data;
            try {
                data = JSON.parse(raw);
            } catch (parseErr) {
                // Сервис вернул не JSON — скорее всего, сообщение об ошибке
                throw new Error(
                    'Сервис вернул неожиданный ответ. ' +
                    'Возможно, локация не распознана или превышен лимит запросов.'
                );
            }

            const parsed = parseWeather(data);

            if (!parsed) {
                hideAllStatus();
                show(els.emptyMsg);
                return;
            }

            // Заполняем виджеты
            setWidgetValue(els.tempValue, parsed.temperature, '°C');
            setWidgetValue(els.windValue, parsed.windSpeed, 'км/ч');
            setWidgetValue(els.precipValue, parsed.precipitation, 'мм');

            // Время наблюдения и время загрузки
            if (els.dataTime) {
                els.dataTime.textContent = parsed.observedAt || '—';
            }
            if (els.loadTime) {
                els.loadTime.textContent = formatDateTime(new Date().toISOString());
            }

            hideAllStatus();

        } catch (error) {
            console.error('[Dashboard] Ошибка:', error);

            let message = 'Не удалось загрузить данные. ';
            if (error instanceof TypeError && error.message.includes('fetch')) {
                message += 'Проверьте подключение к интернету или запустите страницу через локальный сервер.';
            } else {
                message += error.message || 'Попробуйте обновить страницу.';
            }

            showError(message);

            setWidgetValue(els.tempValue, null, '°C');
            setWidgetValue(els.windValue, null, 'км/ч');
            setWidgetValue(els.precipValue, null, 'мм');
            if (els.dataTime) els.dataTime.textContent = '—';
        } finally {
            isFetching = false;
            if (els.refreshBtn) els.refreshBtn.disabled = false;
            if (els.refreshIcon) els.refreshIcon.classList.remove('spin');
        }
    }

    // ── Обработчики кнопок обновления ──
    if (els.refreshBtn) els.refreshBtn.addEventListener('click', fetchWeather);
    if (els.retryBtn) els.retryBtn.addEventListener('click', fetchWeather);

    // ── Первая загрузка и автообновление каждые 10 минут ──
    fetchWeather();
    setInterval(fetchWeather, 10 * 60 * 1000);

})();