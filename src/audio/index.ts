import { AudioEngine } from './engine'
import { Sfx } from './sfx'
import { Ambient } from './ambient'

export const audio = new AudioEngine()
export const sfx = new Sfx(audio)
export const ambient = new Ambient(audio)
