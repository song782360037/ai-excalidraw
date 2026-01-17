import { EXCALIDRAW_SYSTEM_PROMPT } from './prompt'
import type { ElementSummary, ElementUpdate, LayoutCheckResult } from '@/components/excalidraw/wrapper'

export interface AIConfig {
  apiKey: string
  baseURL: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

/**
 * 工具执行器接口
 */
export interface ToolExecutor {
  getCanvasElements: () => ElementSummary[]
  getElementsByIds: (ids: string[]) => { elements: ElementSummary[], notFound: string[] }
  deleteElements: (ids: string[]) => { deleted: string[], notFound: string[] }
  updateElements: (updates: ElementUpdate[]) => { updated: string[], notFound: string[] }
  moveElements: (ids: string[], dx: number, dy: number) => { moved: string[], notFound: string[] }
  checkAndFixLayout: (minGap?: number) => LayoutCheckResult
}

/**
 * 定义可用的工具
 */
const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_canvas_elements',
      description: '获取画布上所有元素。仅在需要了解画布全貌且用户未选中任何元素时使用。如果用户已选中元素，直接使用提供的元素信息即可，无需调用此工具。',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_elements_by_ids',
      description: '根据 ID 获取指定元素详情。已知元素 ID 时使用，比 get_canvas_elements 更高效。',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要获取的元素 id 数组'
          }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_elements',
      description: '删除元素。删形状时自动删除其中的文字。',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要删除的元素 id 数组'
          }
        },
        required: ['ids']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_elements',
      description: '修改现有元素的属性（颜色、文本、大小等）。只传 id + 要改的属性，其他保持原值。修改现有元素时首选此工具，比输出 JSON 更高效。',
      parameters: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '元素 id（必填）' },
                x: { type: 'number', description: 'X 坐标' },
                y: { type: 'number', description: 'Y 坐标' },
                width: { type: 'number', description: '宽度' },
                height: { type: 'number', description: '高度' },
                text: { type: 'string', description: '文本内容' },
                strokeColor: { type: 'string', description: '边框色' },
                backgroundColor: { type: 'string', description: '背景色' },
                strokeWidth: { type: 'number', description: '边框宽' },
                strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: '边框样式' },
                fillStyle: { type: 'string', enum: ['solid', 'hachure', 'cross-hatch'], description: '填充样式' },
                opacity: { type: 'number', description: '透明度 0-100' },
                fontSize: { type: 'number', description: '字体大小' }
              },
              required: ['id']
            },
            description: '要更新的元素数组'
          }
        },
        required: ['elements']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'move_elements',
      description: '批量移动元素。传 id 数组和位移量，自动处理绑定元素。调整布局时使用。',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: '要移动的元素 id 数组'
          },
          dx: {
            type: 'number',
            description: 'X 位移（正=右，负=左）'
          },
          dy: {
            type: 'number',
            description: 'Y 位移（正=下，负=上）'
          }
        },
        required: ['ids', 'dx', 'dy']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_and_fix_layout',
      description: '检查并自动修复布局问题。生成元素后必须调用此工具检查重叠和超出边界，工具会自动修复发现的问题。',
      parameters: {
        type: 'object',
        properties: {
          min_gap: {
            type: 'number',
            description: '元素最小间距（像素），默认 40'
          }
        },
        required: []
      }
    }
  }
]

const STORAGE_KEY = 'ai-excalidraw-config'

/**
 * 获取 AI 配置（优先环境变量，其次 localStorage）
 */
export function getAIConfig(): AIConfig {
  // 优先从环境变量读取
  const envConfig: AIConfig = {
    apiKey: import.meta.env.VITE_AI_API_KEY || '',
    baseURL: import.meta.env.VITE_AI_BASE_URL || '',
    model: import.meta.env.VITE_AI_MODEL || 'gpt-4o',
  }

  // 如果环境变量已配置，直接返回
  if (envConfig.apiKey && envConfig.baseURL) {
    return envConfig
  }

  // 否则从 localStorage 读取
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AIConfig>
      return {
        apiKey: parsed.apiKey || envConfig.apiKey,
        baseURL: parsed.baseURL || envConfig.baseURL,
        model: parsed.model || envConfig.model,
      }
    }
  } catch {
    // ignore
  }

  return envConfig
}

/**
 * 保存 AI 配置到 localStorage
 */
export function saveAIConfig(config: AIConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    console.warn('Failed to save AI config')
  }
}

/**
 * 检查配置是否有效
 */
export function isConfigValid(config: AIConfig): boolean {
  return !!(config.apiKey && config.baseURL && config.model)
}

/**
 * 构建包含选中元素信息的用户消息（精简版）
 */
function buildUserMessage(userMessage: string, selectedElements?: ElementSummary[]): string {
  if (!selectedElements || selectedElements.length === 0) {
    return userMessage
  }

  // 分离主元素和绑定元素
  const mainElements = selectedElements.filter(el => !el.containerId)
  const boundElements = selectedElements.filter(el => el.containerId)

  // 精简格式：id|类型|文本|位置|尺寸|颜色
  const formatElement = (el: ElementSummary, indent = '') => {
    const parts = [el.id, el.type]
    if (el.text) parts.push(`"${el.text}"`)
    parts.push(`(${el.x},${el.y})`)
    parts.push(`${el.width}x${el.height}`)
    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      parts.push(el.backgroundColor)
    }
    return `${indent}${parts.join(' | ')}`
  }

  // 构建上下文
  let ctx = ''
  for (const el of mainElements) {
    ctx += formatElement(el) + '\n'
    // 绑定元素
    const children = boundElements.filter(b => b.containerId === el.id)
    for (const child of children) {
      ctx += formatElement(child, '  └─ ') + '\n'
    }
  }
  
  // 孤立绑定元素
  const orphans = boundElements.filter(b => !mainElements.find(m => m.id === b.containerId))
  for (const el of orphans) {
    ctx += formatElement(el) + '\n'
  }

  return `选中元素：
${ctx}
用户请求：${userMessage}

请修改这些元素，保持相同 id。`
}

/**
 * 流式调用 AI API（支持工具调用）
 */
export async function streamChat(
  userMessage: string,
  onChunk: (content: string) => void,
  onError?: (error: Error) => void,
  config?: AIConfig,
  selectedElements?: ElementSummary[],
  toolExecutor?: ToolExecutor,
  historyMessages?: { role: string; content: string }[]
): Promise<void> {
  const finalConfig = config || getAIConfig()

  if (!isConfigValid(finalConfig)) {
    onError?.(new Error('请先配置 AI API'))
    return
  }

  // 构建带有选中元素上下文的用户消息
  const contextualMessage = buildUserMessage(userMessage, selectedElements)

  // 构建消息数组，包含历史消息
  const messages: ChatMessage[] = [
    { role: 'system', content: EXCALIDRAW_SYSTEM_PROMPT },
  ]

  // 添加历史消息（只保留 user 和 assistant）
  if (historyMessages && historyMessages.length > 0) {
    for (const msg of historyMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content })
      }
    }
  }

  // 添加当前用户消息
  messages.push({ role: 'user', content: contextualMessage })

  // 递归处理，支持多轮工具调用
  await processChat(messages, finalConfig, onChunk, onError, toolExecutor)
}

/**
 * 处理聊天请求（可递归处理工具调用）
 */
async function processChat(
  messages: ChatMessage[],
  config: AIConfig,
  onChunk: (content: string) => void,
  onError?: (error: Error) => void,
  toolExecutor?: ToolExecutor,
  maxToolCalls = 3  // 最大工具调用次数，防止无限循环
): Promise<void> {
  try {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      messages,
      stream: true,
    }

    // 如果有工具执行器，添加工具定义
    if (toolExecutor) {
      requestBody.tools = TOOLS
      requestBody.tool_choice = 'auto'
    }

    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API 请求失败: ${response.status} ${errorText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('无法读取响应流')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullContent = ''
    const toolCalls: Map<number, ToolCall> = new Map()
    let finishReason: string | null = null  // 记录结束原因

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // 按行处理 SSE 格式
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 保留最后不完整的行

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        
        const data = trimmed.slice(6)
        if (data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          const choice = json.choices?.[0]
          const delta = choice?.delta
          
          // 记录结束原因（关键！用于判断是否需要继续工具调用）
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason
          }
          
          // 处理思考内容（支持 reasoning_content / thinking 字段）
          const thinking = delta?.reasoning_content || delta?.thinking
          if (thinking) {
            // 使用特殊标记包裹思考内容
            onChunk(`<think>${thinking}</think>`)
          }
          
          // 处理文本内容
          if (delta?.content) {
            fullContent += delta.content
            onChunk(delta.content)
          }
          
          // 处理工具调用
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const index = tc.index ?? 0
              if (!toolCalls.has(index)) {
                toolCalls.set(index, {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: '', arguments: '' }
                })
              }
              const existing = toolCalls.get(index)!
              if (tc.id) existing.id = tc.id
              if (tc.function?.name) existing.function.name = tc.function.name
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
            }
          }
        } catch {
          // 解析失败，可能是不完整的 JSON，跳过
        }
      }
    }

    // 处理最后的 buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
        try {
          const json = JSON.parse(trimmed.slice(6))
          const delta = json.choices?.[0]?.delta
          if (delta?.content) {
            fullContent += delta.content
            onChunk(delta.content)
          }
        } catch {
          // ignore
        }
      }
    }

    // 如果有工具调用，执行工具并继续对话
    // 关键修复：同时检查 finish_reason 是否为 tool_calls 或 stop
    // 有些模型在工具调用时 finish_reason 为 'tool_calls'，有些为 'stop' 但有 tool_calls 数据
    const hasToolCalls = toolCalls.size > 0 && Array.from(toolCalls.values()).some(
      tc => tc.id && tc.function.name  // 确保工具调用有效
    )
    const shouldProcessTools = hasToolCalls && toolExecutor && maxToolCalls > 0
    
    if (shouldProcessTools) {
      const toolCallsArray = Array.from(toolCalls.values()).filter(
        tc => tc.id && tc.function.name  // 过滤无效的工具调用
      )
      
      if (toolCallsArray.length > 0) {
        // 添加助手消息（包含工具调用）
        messages.push({
          role: 'assistant',
          content: fullContent || null,  // 允许空内容
          tool_calls: toolCallsArray
        } as ChatMessage)

        // 执行每个工具调用并添加结果
        for (const tc of toolCallsArray) {
          const result = executeToolCall(tc, toolExecutor)
          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: tc.id
          })
          
          // 输出结构化的工具调用信息
          let parsedResult: Record<string, unknown> = {}
          try {
            parsedResult = JSON.parse(result)
          } catch {
            parsedResult = { message: result }
          }
          
          const toolInfo = {
            name: tc.function.name,
            args: safeParseArgs(tc.function.arguments),
            result: parsedResult
          }
          onChunk(`<tool_call>${JSON.stringify(toolInfo)}</tool_call>`)
        }

        // 递归调用继续对话
        await processChat(messages, config, onChunk, onError, toolExecutor, maxToolCalls - 1)
      }
    } else if (finishReason === 'tool_calls' && toolCalls.size > 0) {
      // 边缘情况：finish_reason 是 tool_calls 但工具信息不完整
      console.warn('Tool call indicated but tool data incomplete:', toolCalls)
      onChunk('\n\n[工具调用信息不完整，请重试]\n\n')
    }
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * 安全解析工具参数（用于展示）
 */
function safeParseArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args)
  } catch {
    return {}
  }
}

/**
 * 执行工具调用
 */
function executeToolCall(toolCall: ToolCall, executor: ToolExecutor): string {
  const { name, arguments: args } = toolCall.function
  
  switch (name) {
    case 'get_canvas_elements': {
      const elements = executor.getCanvasElements()
      if (elements.length === 0) {
        return JSON.stringify({ message: '画布为空，没有任何元素' })
      }
      return JSON.stringify({
        message: `画布上共有 ${elements.length} 个元素`,
        elements: elements.map(el => ({
          id: el.id,
          type: el.type,
          text: el.text,
          position: { x: el.x, y: el.y },
          size: { width: el.width, height: el.height },
          strokeColor: el.strokeColor,
          backgroundColor: el.backgroundColor,
          containerId: el.containerId
        }))
      })
    }
    case 'get_elements_by_ids': {
      try {
        const parsed = JSON.parse(args)
        const ids = parsed.ids as string[]
        if (!Array.isArray(ids) || ids.length === 0) {
          return JSON.stringify({ error: '请提供要获取的元素 id 数组' })
        }
        const result = executor.getElementsByIds(ids)
        if (result.elements.length === 0) {
          return JSON.stringify({ 
            message: '没有找到指定的元素',
            notFound: result.notFound 
          })
        }
        return JSON.stringify({
          message: `找到 ${result.elements.length} 个元素`,
          elements: result.elements.map(el => ({
            id: el.id,
            type: el.type,
            text: el.text,
            position: { x: el.x, y: el.y },
            size: { width: el.width, height: el.height },
            strokeColor: el.strokeColor,
            backgroundColor: el.backgroundColor,
            containerId: el.containerId
          })),
          notFound: result.notFound.length > 0 ? result.notFound : undefined
        })
      } catch (e) {
        return JSON.stringify({ error: `参数解析失败: ${e}` })
      }
    }
    case 'delete_elements': {
      try {
        const parsed = JSON.parse(args)
        const ids = parsed.ids as string[]
        if (!Array.isArray(ids) || ids.length === 0) {
          return JSON.stringify({ error: '请提供要删除的元素 id 数组' })
        }
        const result = executor.deleteElements(ids)
        if (result.deleted.length === 0) {
          return JSON.stringify({ 
            message: '没有找到可删除的元素',
            notFound: result.notFound 
          })
        }
        return JSON.stringify({
          message: `成功删除 ${result.deleted.length} 个元素`,
          deleted: result.deleted,
          notFound: result.notFound.length > 0 ? result.notFound : undefined
        })
      } catch (e) {
        return JSON.stringify({ error: `参数解析失败: ${e}` })
      }
    }
    case 'update_elements': {
      try {
        const parsed = JSON.parse(args)
        const elements = parsed.elements as { id: string; [key: string]: unknown }[]
        if (!Array.isArray(elements) || elements.length === 0) {
          return JSON.stringify({ error: '请提供要更新的元素数组' })
        }
        // 检查每个元素都有 id
        for (const el of elements) {
          if (!el.id) {
            return JSON.stringify({ error: '每个元素必须包含 id' })
          }
        }
        const result = executor.updateElements(elements)
        if (result.updated.length === 0) {
          return JSON.stringify({ 
            message: '没有找到可更新的元素',
            notFound: result.notFound 
          })
        }
        return JSON.stringify({
          message: `成功更新 ${result.updated.length} 个元素`,
          updated: result.updated,
          notFound: result.notFound.length > 0 ? result.notFound : undefined
        })
      } catch (e) {
        return JSON.stringify({ error: `参数解析失败: ${e}` })
      }
    }
    case 'move_elements': {
      try {
        const parsed = JSON.parse(args)
        const ids = parsed.ids as string[]
        const dx = parsed.dx as number
        const dy = parsed.dy as number
        if (!Array.isArray(ids) || ids.length === 0) {
          return JSON.stringify({ error: '请提供要移动的元素 id 数组' })
        }
        if (typeof dx !== 'number' || typeof dy !== 'number') {
          return JSON.stringify({ error: '请提供有效的位移量 dx 和 dy' })
        }
        const result = executor.moveElements(ids, dx, dy)
        if (result.moved.length === 0) {
          return JSON.stringify({ 
            message: '没有找到可移动的元素',
            notFound: result.notFound 
          })
        }
        return JSON.stringify({
          message: `成功移动 ${result.moved.length} 个元素`,
          moved: result.moved,
          notFound: result.notFound.length > 0 ? result.notFound : undefined
        })
      } catch (e) {
        return JSON.stringify({ error: `参数解析失败: ${e}` })
      }
    }
    case 'check_and_fix_layout': {
      try {
        let minGap = 40
        if (args && args.trim()) {
          const parsed = JSON.parse(args)
          if (typeof parsed.min_gap === 'number') {
            minGap = parsed.min_gap
          }
        }
        const result = executor.checkAndFixLayout(minGap)
        return JSON.stringify({
          success: true,
          hasIssues: result.hasIssues,
          issues: result.issues,
          fixedCount: result.fixedCount,
          message: result.message
        })
      } catch (e) {
        return JSON.stringify({ error: `布局检查失败: ${e}` })
      }
    }
    default:
      return JSON.stringify({ error: `未知工具: ${name}` })
  }
}
