import { post } from 'needle'
import * as utils from '../utils/utils'
import { EVENT } from '../constants'
import { AuthenticationHandler, UserAuthenticationCallback, DeepstreamServices, InternalDeepstreamConfig, DeepstreamPlugin } from '../types'
import { JSONObject } from '../../binary-protocol/src/message-constants'
import { AuthenticationCallback } from '@deepstream/client/dist/src/connection/connection'

interface HttpAuthenticationHandlerSettings {
  // http(s) endpoint that will receive post requests
  endpointUrl: string
  // an array of http status codes that qualify as permitted
  permittedStatusCodes: number[]
  // time in milliseconds before the request times out if no reply is received
  requestTimeout: number
  // fields to copy from authData to header, useful for when endpoints authenticate using middleware
  promoteToHeader: string[],
  // any array of status codes that should be retries, useful if the server is down during a deploy
  // or generally unresponsive
  retryStatusCodes: number[],
  // the maximum amount of retries before returning a false login
  retryAttempts: number,
  // the time in milliseconds between retries
  retryInterval: number
}

export default class HttpAuthenticationHandler extends DeepstreamPlugin implements AuthenticationHandler {
  public description: string = `http webhook to ${this.settings.endpointUrl}`
  private retryAttempts = new Map<number, { connectionData: any, authData: any, callback: UserAuthenticationCallback, attempts: number } >()
  private requestId = 0

  constructor (private settings: HttpAuthenticationHandlerSettings, private services: DeepstreamServices, config: InternalDeepstreamConfig) {
    super()
    this.validateSettings()
    if (this.settings.promoteToHeader === undefined) {
      this.settings.promoteToHeader = []
    }
  }

  public isValidUser (connectionData: JSONObject, authData: JSONObject, callback: AuthenticationCallback): void {
    this.validate(this.requestId++, connectionData, authData, callback)
  }

  private validate (id: number, connectionData: JSONObject, authData: JSONObject, callback: AuthenticationCallback): void {
    const options = {
      read_timeout: this.settings.requestTimeout,
      open_timeout: this.settings.requestTimeout,
      response_timeout: this.settings.requestTimeout,
      follow_max: 2,
      json: true,
      headers: {}
    }

    if (this.settings.promoteToHeader.length > 0) {
      options.headers = this.settings.promoteToHeader.reduce(
        (result, property) => {
          if (authData[property]) {
            result[property] = authData[property]
          }
          return result
        },
        {} as JSONObject
      )
    }

    post(this.settings.endpointUrl, { connectionData, authData }, options, (error, response) => {
      if (error) {
        this.services.logger.warn(EVENT.AUTH_ERROR, `http auth error: ${error}`)
        this.retry(id, connectionData, authData, callback)
        return
      }

      if (!response.statusCode) {
        this.services.logger.warn(EVENT.AUTH_ERROR, 'http auth server error: missing status code!')
        this.retryAttempts.delete(id)
        callback(false, null)
        return
      }

      if (response.statusCode >= 500 && response.statusCode < 600) {
        this.services.logger.warn(EVENT.AUTH_ERROR, `http auth server error: ${JSON.stringify(response.body)}`)
      }

      if (this.settings.retryStatusCodes.includes(response.statusCode)) {
        this.retry(id, connectionData, authData, callback)
        return
      }

      this.retryAttempts.delete(id)

      if (this.settings.permittedStatusCodes.indexOf(response.statusCode) === -1) {
        callback(false, response.body || null)
        return
      }

      if (response.body && typeof response.body === 'string') {
        callback(true, { username: response.body })
        return
      }

      callback(true, response.body || null)
    })
  }

  private retry (id: number, connectionData: JSONObject, authData: JSONObject, callback: AuthenticationCallback) {
    let retryAttempt = this.retryAttempts.get(id)
    if (!retryAttempt) {
      retryAttempt = {
        connectionData,
        authData,
        callback,
        attempts: 0
      }
      this.retryAttempts.set(id, retryAttempt)
    } else {
      retryAttempt.attempts++
    }
    if (retryAttempt.attempts < this.settings.retryAttempts) {
      setTimeout(() => this.validate(id, connectionData, authData, callback), this.settings.retryInterval)
    } else {
      this.retryAttempts.delete(id)
      callback(false, { error: EVENT.AUTH_RETRY_ATTEMPTS_EXCEEDED })
    }
  }

  private validateSettings (): void {
    utils.validateMap(this.settings, true, {
      endpointUrl: 'url',
      permittedStatusCodes: 'array',
      requestTimeout: 'number',
      retryStatusCodes: 'array',
      retryAttempts: 'number',
      retryInterval: 'number'
    })
  }
}