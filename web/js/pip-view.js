/**
 * 两类小窗 (视频小窗 / 字幕小窗) 状态 → 界面绘制的纯函数映射。
 *
 * 播放页的两类画中画互斥: 同一时刻至多一个 active。这里把「当前真实状态」
 * 一次性映射成按钮 aria、占位提示和 app 类名, 调用方单点绘制, 两个按钮永远
 * 来自同一份快照, 不会画出「同时开启」的中间态。纯函数, 不碰 DOM, 可直接在
 * Node 里 import 测试。
 */

/**
 * @param {{videoActive?: boolean, audioActive?: boolean, audioSupported?: boolean, audioBusy?: boolean}} state
 *   两类小窗的真实状态, 来自 pip.isActive() 与 audioPip.isActive()/isBusy()/supported()。
 * @returns 按钮、占位提示与 app 类名应呈现的值。
 */
export function pipView({ videoActive = false, audioActive = false, audioSupported = false, audioBusy = false } = {}) {
  const video = !!videoActive;
  const audio = !!audioActive;
  return {
    video: {
      pressed: video,
      label: video ? '关闭小窗' : '小窗播放',
    },
    audio: {
      hidden: !audioSupported,
      pressed: audio,
      busy: !!audioBusy,
      label: audio ? '关闭字幕画中画' : '字幕画中画',
    },
    note: {
      hidden: !video && !audio,
      text: audio ? '退出字幕小窗' : '退出小窗播放',
    },
    classes: {
      'is-pip': video,
      'is-audio-pip': audio,
    },
  };
}
