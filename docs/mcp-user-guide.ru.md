# Руководство по использованию MCP-интеграции

## Что такое MCP?

**Model Context Protocol (MCP)** — это протокол, который позволяет AI-ассистентам (Claude, Cursor и др.) напрямую взаимодействовать с панелью C³ CELERITY. Через MCP AI может:

- Управлять пользователями VPN (создание, редактирование, блокировка)
- Настраивать серверы и ноды
- Выполнять SSH-команды на серверах
- Получать статистику и логи
- Диагностировать проблемы

## Требования

- API-ключ с правом `mcp:enabled`
- AI-клиент с поддержкой MCP (Claude Desktop, Cursor IDE или другой HTTP-клиент с SSE)

## Создание API-ключа

1. Откройте панель → **Settings** → **API Keys**
2. Нажмите **Создать MCP API-ключ**
3. Укажите название ключа (например, "Claude Assistant")
4. Выберите права:
   - Базовые: `mcp:enabled` + права на чтение (по умолчанию)
   - Расширенные: `users:write`, `nodes:write`, `sync:write` — для операций записи
5. Скопируйте ключ — он показывается только один раз

## Подключение AI-клиентов

### Claude Desktop

Добавьте в файл конфигурации Claude Desktop:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "celerity": {
      "url": "https://your-panel.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Cursor IDE

Создайте файл `.cursor/mcp.json` в корне проекта:

```json
{
  "mcpServers": {
    "celerity": {
      "url": "https://your-panel.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Кастомный клиент

Любой HTTP-клиент с поддержкой SSE может подключиться:

- **Endpoint**: `https://your-panel.com/api/mcp`
- **Auth**: `Authorization: Bearer YOUR_API_KEY`
- **Content-Type**: `application/json`
- **Accept**: `text/event-stream` (для стриминга)

Пример запроса:

```bash
curl -X POST https://your-panel.com/api/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}'
```

## Доступные инструменты

### query — Чтение данных

Универсальный инструмент для получения данных из панели.

| Ресурс | Описание | Требуемый scope |
|--------|----------|-----------------|
| `users` | Список пользователей | `users:read` |
| `nodes` | Список серверов | `nodes:read` |
| `groups` | Группы серверов | `stats:read` |
| `stats` | Статистика трафика | `stats:read` |
| `logs` | Системные логи | `stats:read` |

Параметры:
- `resource` (обязательно) — тип ресурса
- `id` — конкретный ID элемента
- `filter` — фильтры (зависят от ресурса)
- `limit`, `page` — пагинация
- `sortBy`, `sortOrder` — сортировка

**Пример**: Получить всех активных пользователей

```json
{
  "name": "query",
  "arguments": {
    "resource": "users",
    "filter": { "enabled": true },
    "limit": 50
  }
}
```

### manage_user — Управление пользователями

Действия: `create`, `update`, `delete`, `enable`, `disable`, `reset_traffic`

Требуемый scope: `users:write`

**Пример**: Создать пользователя

```json
{
  "name": "manage_user",
  "arguments": {
    "action": "create",
    "userId": "user123",
    "data": {
      "username": "Иван Иванов",
      "trafficLimit": 107374182400,
      "maxDevices": 3,
      "groups": ["groupId1"]
    }
  }
}
```

### manage_node — Управление серверами

Действия: `create`, `update`, `delete`, `sync`, `setup`, `reset_status`, `update_config`

Требуемый scope: `nodes:write`

**Пример**: Настроить ноду через SSH

```json
{
  "name": "manage_node",
  "arguments": {
    "action": "setup",
    "id": "nodeId123",
    "setupOptions": {
      "installHysteria": true,
      "setupPortHopping": true,
      "restartService": true
    }
  }
}
```

### manage_group — Управление группами

Действия: `create`, `update`, `delete`

Требуемый scope: `nodes:write`

### manage_cascade — Каскадные туннели

Действия: `create`, `update`, `delete`, `deploy`, `undeploy`, `reconnect`

Требуемый scope: `nodes:write`

### execute_ssh — Выполнение команд

Выполняет shell-команду на сервере и возвращает вывод.

Требуемый scope: `nodes:write`

**Пример**: Проверить статус сервиса

```json
{
  "name": "execute_ssh",
  "arguments": {
    "nodeId": "nodeId123",
    "command": "systemctl status hysteria-server"
  }
}
```

### ssh_session — Интерактивная SSH-сессия

Действия: `start`, `input`, `close`

Требуемый scope: `nodes:write`

### system_action — Системные операции

Действия: `sync_all`, `clear_cache`, `backup`, `kick_user`

Требуемый scope: `sync:write`

### get_topology — Топология сети

Возвращает все активные ноды и связи между ними.

Требуемый scope: `nodes:read`

### health_check — Проверка состояния

Возвращает uptime, статус синхронизации, статистику кэша, использование памяти.

Scope не требуется.

## Готовые промпты

Промпты — это предустановленные сценарии, которые появляются как slash-команды в Claude Desktop (например, `/panel_overview`).

| Промпт | Описание |
|--------|----------|
| `panel_overview` | Общий обзор системы: ноды, пользователи, здоровье |
| `audit_nodes` | Найти проблемные ноды и предложить исправления |
| `user_report` | Детальный отчёт по конкретному пользователю |
| `setup_new_node` | Пошаговое добавление новой ноды |
| `troubleshoot_node` | Диагностика ноды через SSH |
| `manage_expired_users` | Поиск и обработка истёкших пользователей |

## Примеры использования

### "Покажи состояние всех серверов"

AI выполнит:
1. `health_check` — общее состояние
2. `query` с `resource=nodes` — список нод
3. Сформирует отчёт с проблемными нодами

### "Создай пользователя testuser с лимитом 50 ГБ"

AI выполнит:
1. `manage_user` с `action=create`, `userId=testuser`, `trafficLimit=53687091200`

### "Почему нода DE-01 не работает?"

AI выполнит:
1. `query` с `resource=nodes`, `id=<DE-01-id>` — получить lastError
2. `execute_ssh` с командой `systemctl status hysteria-server`
3. Проанализирует и предложит решение

### "Настрой новый сервер 192.168.1.100"

AI использует промпт `setup_new_node` и проведёт через все шаги:
1. Соберёт данные (IP, домен, SSH-реквизиты)
2. Создаст ноду через `manage_node`
3. Запустит автонастройку через `manage_node action=setup`
4. Проверит статус

## Права доступа (Scopes)

| Scope | Описание |
|-------|----------|
| `mcp:enabled` | Базовое право для MCP-доступа |
| `users:read` | Чтение пользователей |
| `users:write` | Создание, изменение, удаление пользователей |
| `nodes:read` | Чтение серверов и статистики |
| `nodes:write` | Управление серверами, SSH-команды |
| `stats:read` | Чтение статистики и логов |
| `sync:write` | Синхронизация, бэкапы, системные операции |

## Безопасность

- API-ключи хранитесь в безопасном месте
- Используйте минимально необходимые права
- Периодически ротируйте ключи
- Все MCP-операции логируются в системных логах панели

---

**Источники**: 
- `src/services/mcpService.js` — реестр инструментов
- `src/routes/mcp.js` — MCP-эндпоинты
- `src/mcp/prompts.js` — предустановленные промпты
- `src/locales/ru.json` — локализация интерфейса MCP
