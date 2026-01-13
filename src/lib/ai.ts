import { EXCALIDRAW_SYSTEM_PROMPT } from './prompt'
import type { ElementSummary, ElementUpdate } from '@/components/excalidraw/wrapper'

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
  deleteElements: (ids: string[]) => { deleted: string[], notFound: string[] }
  updateElements: (updates: ElementUpdate[]) => { updated: string[], notFound: string[] }
  moveElements: (ids: string[], dx: number, dy: number) => { moved: string[], notFound: string[] }
}

/**
 * 定义可用的工具
 */
const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_canvas_elements',
      description: '获取画布上所有元素的信息，包括形状、文字、箭头等。当需要了解画布当前状态时调用此工具。',
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
      name: 'delete_elements',
      description: '删除画布上指定的元素。传入要删除的元素 id 数组。注意：删除形状时会自动删除绑定在其中的文字。',
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
      description: '更新画布上现有元素的属性（如颜色、文本、大小等）。只需传入 id 和要修改的属性，未传入的属性保持原值。修改现有元素时优先使用此工具。',
      parameters: {
        type: 'object',
        properties: {
          elements: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '元素 id（必填）' },
                x: { type: 'number', description: '新的 X 坐标' },
                y: { type: 'number', description: '新的 Y 坐标' },
                width: { type: 'number', description: '新的宽度' },
                height: { type: 'number', description: '新的高度' },
                text: { type: 'string', description: '新的文本内容' },
                strokeColor: { type: 'string', description: '新的边框颜色' },
                backgroundColor: { type: 'string', description: '新的背景色' },
                strokeWidth: { type: 'number', description: '新的边框宽度' },
                strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'], description: '新的边框样式' },
                fillStyle: { type: 'string', enum: ['solid', 'hachure', 'cross-hatch'], description: '新的填充样式' },
                opacity: { type: 'number', description: '新的透明度 (0-100)' },
                fontSize: { type: 'number', description: '新的字体大小' }
              },
              required: ['id']
            },
            description: '要更新的元素数组，每个元素必须包含 id 和要修改的属性'
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
      description: '批量移动画布上的元素。传入元素 id 数组和位移量，会自动移动关联的绑定元素（如形状内的文字）。调整布局时使用。',
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
            description: 'X 方向位移量（正数向右，负数向左）'
          },
          dy: {
            type: 'number',
            description: 'Y 方向位移量（正数向下，负数向上）'
          }
        },
        required: ['ids', 'dx', 'dy']
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
 * 构建包含选中元素信息的用户消息
 */
function buildUserMessage(userMessage: string, selectedElements?: ElementSummary[]): string {
  if (!selectedElements || selectedElements.length === 0) {
    return userMessage
  }

  // 分离主元素和绑定元素
  const mainElements = selectedElements.filter(el => !el.containerId)
  const boundElements = selectedElements.filter(el => el.containerId)

  // 构建元素描述
  const formatElement = (el: ElementSummary, indent = '') => {
    const parts = [`id: ${el.id}`, `type: ${el.type}`]
    if (el.text) parts.push(`text: "${el.text}"`)
    parts.push(`position: (${el.x}, ${el.y})`)
    parts.push(`size: ${el.width}x${el.height}`)
    if (el.strokeColor) parts.push(`strokeColor: ${el.strokeColor}`)
    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      parts.push(`backgroundColor: ${el.backgroundColor}`)
    }
    return `${indent}- ${parts.join(', ')}`
  }

  // 构建上下文
  let elementsContext = ''
  for (const el of mainElements) {
    elementsContext += formatElement(el) + '\n'
    // 添加该元素的绑定元素（如形状内的文字）
    const children = boundElements.filter(b => b.containerId === el.id)
    for (const child of children) {
      elementsContext += formatElement(child, '  ') + ' (绑定在 ' + el.id + ' 内的文字)\n'
    }
  }
  
  // 添加没有父元素的绑定元素（理论上不应该发生）
  const orphanBound = boundElements.filter(b => !mainElements.find(m => m.id === b.containerId))
  for (const el of orphanBound) {
    elementsContext += formatElement(el) + '\n'
  }

  return `用户选中了以下元素，请基于这些元素进行修改：
${elementsContext}
用户的请求：${userMessage}

注意：修改现有元素时，请保持相同的 id，这样会更新而不是新建元素。`
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
          const delta = json.choices?.[0]?.delta
          
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
    if (toolCalls.size > 0 && toolExecutor && maxToolCalls > 0) {
      const toolCallsArray = Array.from(toolCalls.values())
      
      // 添加助手消息（包含工具调用）
      messages.push({
        role: 'assistant',
        content: fullContent,
        tool_calls: toolCallsArray
      })

      // 执行每个工具调用并添加结果
      for (const tc of toolCallsArray) {
        const result = executeToolCall(tc, toolExecutor)
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id
        })
      }

      // 提示用户正在处理
      onChunk('\n\n[正在分析画布内容...]\n\n')

      // 递归调用继续对话
      await processChat(messages, config, onChunk, onError, toolExecutor, maxToolCalls - 1)
    }
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)))
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
    default:
      return JSON.stringify({ error: `未知工具: ${name}` })
  }
}
