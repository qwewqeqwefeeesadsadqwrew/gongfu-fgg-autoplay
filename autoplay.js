/*!
 * 发小广告（game-fgg）自动玩
 * 规则（按用户口径）：
 *   ① 一直点屏幕中间 —— 间隔 0~0.3 秒随机（最快档）
 *   ② 每 3~10 秒随机挑一张卡片，点它的按钮（使用/解锁）—— 卡片随机
 *   ③ 每 3~8 分钟随机点一次「广告翻倍」按钮
 * 点击方式：给 Cocos 节点直接派发 TOUCH_START / TOUCH_END
 *   （桌面浏览器里合成 DOM 鼠标事件进不到引擎，实测过；节点事件实测可用）
 * 顺带负责进小游戏：关「开白」遮罩 → 主页「小游戏」→「发小广告」开始游戏
 */
(function () {
  'use strict';

  var CFG = {
    centerMin: 0, centerMax: 0.3,   // 秒：屏幕中间连点间隔（0~0.3s）
    cardMin: 3.0, cardMax: 10.0,    // 秒：卡片按钮点击间隔
    dblMin: 180, dblMax: 480,       // 秒：广告翻倍按钮点击间隔（3~8 分钟，按钮冷却本身只有 30s）
    enterTick: 400,                 // 毫秒：状态巡检节奏
    maxLog: 300,
    autoEnter: true                 // 自动走「小游戏 → 发小广告」
  };

  var S = {
    running: true,
    taps: 0,
    cardTaps: 0,
    dblTaps: 0,
    lastCard: -1,
    lastDbl: -1,
    phase: 'idle',                  // idle | menu | panel | playing
    targets: null,
    log: []
  };
  window.__autoState = S;

  function log(msg) {
    var line = '[' + new Date().toTimeString().slice(0, 8) + '] ' + msg;
    S.log.push(line);
    if (S.log.length > CFG.maxLog) S.log.shift();
    try { console.log('[auto] ' + msg); } catch (e) {}
  }

  // ---------- 节点事件注入 ----------
  function touchEv(node, type) {
    return {
      type: type, target: node, currentTarget: node, isStopped: false,
      stopPropagation: function () { this.isStopped = true; },
      getLocation: function () { return node.convertToWorldSpaceAR(cc.v2(0, 0)); },
      getID: function () { return 0; },
      getButton: function () { return 0; },
      getDelta: function () { return cc.v2(0, 0); }
    };
  }
  function tap(node) {
    if (!node || !node.isValid) return false;
    node.emit(cc.Node.EventType.TOUCH_START, touchEv(node, 'touchstart'));
    node.emit(cc.Node.EventType.TOUCH_END, touchEv(node, 'touchend'));
    return true;
  }

  // ---------- 遍历小工具 ----------
  function walk(node, fn) {
    fn(node);
    var ch = node.children || [];
    for (var i = 0; i < ch.length; i++) walk(ch[i], fn);
  }
  function scene() { return cc.director && cc.director.getScene ? cc.director.getScene() : null; }
  function pathOf(n) { var p = []; while (n) { p.unshift(n.name); n = n.parent; } return p.join('/'); }
  function findByName(root, name, activeOnly) {
    var hit = null;
    walk(root, function (n) { if (!hit && n.name === name && (!activeOnly || n.activeInHierarchy)) hit = n; });
    return hit;
  }

  // ---------- 定位小游戏本体（挂在 Canvas/GameRoot 下） ----------
  function findView() {
    var sc = scene();
    if (!sc) return null;
    var root = null;
    walk(sc, function (n) {
      if (!root && n.name === '发广告' && n.activeInHierarchy && pathOf(n).indexOf('/Canvas/') > 0) root = n;
    });
    if (!root) return null;
    var view = null;
    (root._components || []).forEach(function (c) { if (c && c.click_area) view = c; });
    if (!view || !view.click_area || !view.click_area.node) return null;
    return view;
  }

  // 卡片按钮：优先「使用」(unclokStatus)，没有就点「解锁」(lockVideoStatus)
  function cardButton(view, idx) {
    var items = view.adItemNodes || [];
    var item = items[idx];
    if (!item || !item.isValid) return null;
    var u = item.getChildByName('unclokStatus');
    if (u && u.activeInHierarchy) return u;
    var v = item.getChildByName('lockVideoStatus');
    if (v && v.activeInHierarchy) return v;
    return null;   // 还在「再点击 N 次解锁」阶段：没有可点的按钮
  }
 
  // 「广告翻倍」按钮：发广告/ui_layer/addBtn（走 ObservablePointerClickTrigger，和 click_area 同一套 tap）
  function dblButton(view) {
    var hit = null;
    walk(view.node, function (n) { if (!hit && n.name === 'addBtn' && n.activeInHierarchy) hit = n; });
    return hit;
  }
  // 看门狗：加 cd 期间 cc.Button.interactable = false，点了也白点，先判一下
  function dblReady(node) {
    var btn = null;
    (node._components || []).forEach(function (c) { if (c && c.interactable !== undefined) btn = c; });
    return !btn || btn.interactable !== false;
  }

  // ---------- 自动进小游戏 ----------
  function hideKaiBai() {
    var sc = scene();
    if (!sc) return false;
    var kb = null;
    walk(sc, function (n) { if (!kb && n.name === '开白' && n.activeInHierarchy) kb = n; });
    if (kb) { kb.active = false; log('关掉「开白」遮罩'); return true; }
    return false;
  }

  function driveEntry() {
    var sc = scene();
    if (!sc) return;
    hideKaiBai();

    // 面板已经打开？找「发小广告」那格的开始按钮
    var panel = findByName(sc, '小游戏界面', true);
    if (panel) {
      var item = null;
      walk(panel, function (n) { if (!item && n.name === 'game-fgg' && n.getChildByName('btn')) item = n; });
      if (item) {
        S.phase = 'panel';
        if (tap(item.getChildByName('btn'))) log('点「发小广告」开始游戏');
        return;
      }
    }

    // 没开面板 → 点主页左下角「小游戏」
    var btn = null;
    walk(sc, function (n) {
      if (!btn && n.name === '小游戏' && pathOf(n).indexOf('GameUiRoot') >= 0) btn = n;
    });
    if (btn) {
      var p = btn.parent;
      while (p && p.name !== '主页') { if (!p.active) p.active = true; p = p.parent; }   // 按钮组默认隐藏
      if (btn.activeInHierarchy) {
        S.phase = 'menu';
        if (tap(btn)) log('点主页「小游戏」入口');
      }
    }
  }

  // ---------- 状态巡检 ----------
  (function tick() {
    setTimeout(function () {
      if (S.running) {
        try {
          var view = findView();
          if (view) {
            if (S.phase !== 'playing') log('进入「发小广告」，开始自动玩');
            S.phase = 'playing';
            S.targets = view;
          } else {
            S.targets = null;
            if (S.phase === 'playing') { log('小游戏关了，回到入口流程'); S.phase = 'idle'; }
            if (CFG.autoEnter && S.phase !== 'playing') driveEntry();
          }
        } catch (e) { log('tick 异常：' + (e && e.message)); }
      }
      tick();
    }, CFG.enterTick);
  })();

  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---------- 循环 ①：屏幕中间连点，0~1 秒随机 ----------
  (function loopCenter() {
    var wait = rand(CFG.centerMin, CFG.centerMax) * 1000;
    setTimeout(function () {
      if (S.running && S.phase === 'playing' && S.targets) {
        var ca = S.targets.click_area;
        if (ca && ca.node && ca.node.activeInHierarchy && tap(ca.node)) {
          S.taps += 1;
          if (S.taps % 25 === 1) log('中间点击累计 ' + S.taps + ' 次');
        }
      }
      loopCenter();
    }, wait);
  })();

  // ---------- 循环 ②：3~10 秒随机挑一张卡点按钮 ----------
  (function loopCard() {
    var wait = rand(CFG.cardMin, CFG.cardMax) * 1000;
    setTimeout(function () {
      if (S.running && S.phase === 'playing' && S.targets) {
        var items = S.targets.adItemNodes || [];
        if (items.length) {
          var idx = Math.floor(Math.random() * items.length);
          var btn = cardButton(S.targets, idx);
          if (btn && tap(btn)) {
            S.cardTaps += 1;
            S.lastCard = idx;
            log('点第 ' + (idx + 1) + ' 张卡（第 ' + S.cardTaps + ' 次）');
          } else {
            log('第 ' + (idx + 1) + ' 张卡还在解锁中，跳过');
          }
        }
      }
      loopCard();
    }, wait);
  })();

  // ---------- 循环 ③：3~8 分钟随机点一次「广告翻倍」 ----------
  (function loopDouble() {
    var wait = rand(CFG.dblMin, CFG.dblMax) * 1000;
    setTimeout(function () {
      if (S.running && S.phase === 'playing' && S.targets) {
        var n = dblButton(S.targets);
        if (n && dblReady(n) && tap(n)) {
          S.dblTaps += 1;
          S.lastDbl = Date.now();
          log('点「广告翻倍」（第 ' + S.dblTaps + ' 次），下次 ' + Math.round(wait / 1000) + 's 后（30s 后收益 ×5）');
        } else if (n) {
          log('「广告翻倍」冷却中，跳过');
        }
      }
      loopDouble();
    }, wait);
  })();

  window.__auto = {
    tap: tap,
    cfg: CFG,
    findView: findView,
    dbl: function (minSec, maxSec) { CFG.dblMin = minSec; CFG.dblMax = maxSec; log('广告翻倍间隔改为 ' + minSec + '~' + maxSec + ' 秒'); },
    stop: function () { S.running = false; log('已停止'); },
    start: function () { S.running = true; log('继续'); }
  };

  log('自动玩已注入：中间连点 0~0.3s，卡片 3~10s，广告翻倍 3~8min（自动进小游戏）');
})();
