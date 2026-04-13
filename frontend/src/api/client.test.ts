import type { InternalAxiosRequestConfig } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAuthSession } from 'aws-amplify/auth'
import apiClient from './client'

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}))

const mockedFetchAuthSession = vi.mocked(fetchAuthSession)

function requestInterceptor() {
  const handlers = (apiClient.interceptors.request as unknown as {
    handlers: Array<{
      fulfilled: (config: InternalAxiosRequestConfig) => Promise<InternalAxiosRequestConfig>
    }>
  }).handlers
  return handlers[0].fulfilled
}

describe('apiClient', () => {
  beforeEach(() => {
    mockedFetchAuthSession.mockReset()
  })

  it('uses /api as default base URL', () => {
    expect(apiClient.defaults.baseURL).toBe('/api')
  })

  it('adds bearer token when session contains id token', async () => {
    mockedFetchAuthSession.mockResolvedValue({
      tokens: {
        idToken: {
          toString: () => 'token-123',
        },
      },
    } as never)

    const config = {
      headers: {},
    } as InternalAxiosRequestConfig

    const output = await requestInterceptor()(config)

    expect(output.headers.Authorization).toBe('Bearer token-123')
  })

  it('does not add authorization header when auth session lookup fails', async () => {
    mockedFetchAuthSession.mockRejectedValue(new Error('no active session'))

    const config = {
      headers: {},
    } as InternalAxiosRequestConfig

    const output = await requestInterceptor()(config)

    expect(output.headers.Authorization).toBeUndefined()
  })
})
