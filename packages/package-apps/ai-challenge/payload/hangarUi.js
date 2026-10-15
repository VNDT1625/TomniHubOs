/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

(function (global) {
  'use strict';

  var WEIGHT_CLASSES = {
    flyweight: {
      id: 'flyweight',
      label: 'Hạng Nhẹ (1B - 3B)',
      paramRange: '1B - 3B',
      description: 'Nhanh nhẹn, tốc độ phản xạ chớp nhoáng, tiết kiệm RAM/VRAM cục bộ.',
      statBudget: 25,
      baseHp: 80,
      baseEnergy: 70,
      baseSpeed: 7,
      basePower: 4,
      baseArmor: 4,
      speedMultiplier: 1.25,
      armorMultiplier: 0.85,
    },
    middleweight: {
      id: 'middleweight',
      label: 'Hạng Trung (7B - 9B)',
      paramRange: '7B - 9B',
      description: 'Cân bằng hoàn hảo giữa sức mạnh tấn công, phòng thủ và phản xạ chiến thuật.',
      statBudget: 30,
      baseHp: 100,
      baseEnergy: 80,
      baseSpeed: 5,
      basePower: 6,
      baseArmor: 6,
      speedMultiplier: 1.0,
      armorMultiplier: 1.0,
    },
    heavyweight: {
      id: 'heavyweight',
      label: 'Hạng Nặng (14B - 70B+)',
      paramRange: '14B - 70B+',
      description: 'Lớp giáp dày cộm, hỏa lực hạng nặng, suy luận chiến lược sâu rộng.',
      statBudget: 35,
      baseHp: 130,
      baseEnergy: 100,
      baseSpeed: 3,
      basePower: 8,
      baseArmor: 8,
      speedMultiplier: 0.8,
      armorMultiplier: 1.25,
    },
  };

  var ELEMENTAL_CORES = {
    lightning: {
      id: 'lightning',
      name: 'Lôi Điện (EMP / Lightning)',
      icon: '⚡',
      color: '#8b5cf6',
      accentColor: '#a78bfa',
      description: 'Đòn đánh gây choáng nhẹ, hút 10 năng lượng đối thủ, tăng 15% tốc độ phản xạ.',
      passiveBonus: { speedBonus: 1.15, energyLeech: 10 },
      specialSkillName: 'Bộc Phá Lôi (EMP Burst)',
    },
    fire: {
      id: 'fire',
      name: 'Nhiệt Hỏa (Thermal / Fire)',
      icon: '🔥',
      color: '#ef4444',
      accentColor: '#f87171',
      description: 'Thiêu đốt sinh lực đối thủ theo thời gian (DoT), tăng 15% sát thương đòn nặng.',
      passiveBonus: { damageMultiplier: 1.15, burnDot: 4 },
      specialSkillName: 'Hỏa Nộ (Overdrive Flame)',
    },
    ice: {
      id: 'ice',
      name: 'Băng Hàn (Cryo / Ice)',
      icon: '❄️',
      color: '#06b6d4',
      accentColor: '#38bdf8',
      description: 'Làm chậm bước di chuyển của đối phương 25%, tăng 20% khả năng chống đỡ.',
      passiveBonus: { slowFactor: 0.25, blockMitigationBonus: 0.2 },
      specialSkillName: 'Băng Giáp (Glacial Shield)',
    },
    cyber: {
      id: 'cyber',
      name: 'Không Gian Số (Cyber / Void)',
      icon: '🔮',
      color: '#ec4899',
      accentColor: '#f472b6',
      description: 'Khiên bảo vệ lượng tử tự tái tạo, hồi phục năng lượng nhanh hơn 25%.',
      passiveBonus: { energyRegenBonus: 1.25, shieldRegen: 8 },
      specialSkillName: 'Lưới Không Gian (Cyber Aegis)',
    },
  };

  var ROBOT_PRESETS = [
    {
      id: 'v-striker',
      name: 'V-Striker',
      weightClass: 'middleweight',
      element: 'lightning',
      allocatedStats: { hp: 8, energy: 8, speed: 6, power: 4, armor: 4 },
      description: 'Chiến binh Mech đa dụng tiêu chuẩn, phản xạ cơ động và cân bằng công thủ.',
    },
    {
      id: 'aegis-sentinel',
      name: 'Aegis Sentinel',
      weightClass: 'heavyweight',
      element: 'ice',
      allocatedStats: { hp: 12, energy: 6, speed: 2, power: 5, armor: 10 },
      description: 'Pháo đài bọc thép băng giá, sức chống chịu kiên cố bẻ gãy mọi đợt tập kích.',
    },
    {
      id: 'cyber-ronin',
      name: 'Cyber Ronin',
      weightClass: 'flyweight',
      element: 'fire',
      allocatedStats: { hp: 4, energy: 5, speed: 9, power: 5, armor: 2 },
      description: 'Kiếm sĩ cơ khí tốc độ cao, thoắt ẩn thoắt hiện với những đòn chém rực lửa.',
    },
  ];

  var QUICK_TACTICS = [
    {
      id: 'shield_defend',
      label: '🛡️ Bật khiên thủ',
      text: 'Bật khiên phòng thủ, canh phản công!',
      urgency: 'advice',
      focusCost: 1,
    },
    {
      id: 'emp_burst',
      label: '⚡ Dồn sát thương EMP',
      text: 'Đối thủ sơ hở, dồn combo EMP ngay!',
      urgency: 'urgent_command',
      focusCost: 2,
    },
    {
      id: 'retreat_recover',
      label: '🏃 Lùi hồi năng lượng',
      text: 'Lùi lại giữ khoảng cách, hồi năng lượng!',
      urgency: 'advice',
      focusCost: 1,
    },
    {
      id: 'ice_slow',
      label: '❄️ Kìm chân băng giá',
      text: 'Đóng băng bước di chuyển của đối thủ!',
      urgency: 'advice',
      focusCost: 1,
    },
    {
      id: 'flame_overdrive',
      label: '🔥 Thiêu đốt rực lửa',
      text: 'Kích hoạt Overdrive, tấn công tổng lực!',
      urgency: 'urgent_command',
      focusCost: 2,
    },
  ];

  /**
   * Tính toán tổng điểm chỉ số đã phân bổ
   */
  function getTotalAllocatedPoints(stats) {
    if (!stats || typeof stats !== 'object') return 0;
    return (
      (Number(stats.hp) || 0) +
      (Number(stats.energy) || 0) +
      (Number(stats.speed) || 0) +
      (Number(stats.power) || 0) +
      (Number(stats.armor) || 0)
    );
  }

  /**
   * Kiểm tra tính hợp lệ của cấu hình Robot (Loadout)
   */
  function validateLoadout(weightClassId, allocatedStats) {
    var weightDef = WEIGHT_CLASSES[weightClassId] || WEIGHT_CLASSES.middleweight;
    var totalAllocated = getTotalAllocatedPoints(allocatedStats);
    var errors = [];

    if (totalAllocated > weightDef.statBudget) {
      errors.push('Tổng điểm thuộc tính (' + totalAllocated + ') vượt quá ngân sách (' + weightDef.statBudget + ').');
    }

    var statKeys = ['hp', 'energy', 'speed', 'power', 'armor'];
    for (var i = 0; i < statKeys.length; i++) {
      var k = statKeys[i];
      var val = Number(allocatedStats[k]) || 0;
      if (val < 0) {
        errors.push('Chỉ số ' + k + ' không được là số âm.');
      }
      if (val > 15) {
        errors.push('Chỉ số ' + k + ' tối đa 15 điểm cộng dồn.');
      }
    }

    return {
      valid: errors.length === 0,
      totalAllocated: totalAllocated,
      budget: weightDef.statBudget,
      remaining: Math.max(0, weightDef.statBudget - totalAllocated),
      errors: errors,
    };
  }

  /**
   * Tính toán chỉ số thực tế sau khi áp dụng hạng cân và lõi nguyên tố
   */
  function calculateEffectiveStats(weightClassId, allocatedStats, elementId) {
    var weightDef = WEIGHT_CLASSES[weightClassId] || WEIGHT_CLASSES.middleweight;
    var elementDef = ELEMENTAL_CORES[elementId] || ELEMENTAL_CORES.lightning;
    var stats = allocatedStats || {};

    var hpBonus = (Number(stats.hp) || 0) * 5;
    var energyBonus = (Number(stats.energy) || 0) * 4;
    var speedBonus = (Number(stats.speed) || 0) * 0.5;
    var powerBonus = (Number(stats.power) || 0) * 1.5;
    var armorBonus = (Number(stats.armor) || 0) * 2;

    var maxHp = Math.round(weightDef.baseHp + hpBonus);
    var maxEnergy = Math.round(weightDef.baseEnergy + energyBonus);
    var rawSpeed = weightDef.baseSpeed + speedBonus;
    var rawPower = weightDef.basePower + powerBonus;
    var rawArmor = weightDef.baseArmor + armorBonus;

    // Element passives
    if (elementDef.passiveBonus.speedBonus) {
      rawSpeed *= elementDef.passiveBonus.speedBonus;
    }
    if (elementDef.passiveBonus.damageMultiplier) {
      rawPower *= elementDef.passiveBonus.damageMultiplier;
    }
    if (elementDef.passiveBonus.blockMitigationBonus) {
      rawArmor *= 1 + elementDef.passiveBonus.blockMitigationBonus;
    }

    return {
      weightClass: weightDef.id,
      weightLabel: weightDef.label,
      element: elementDef.id,
      elementName: elementDef.name,
      elementIcon: elementDef.icon,
      elementColor: elementDef.color,
      maxHp: maxHp,
      maxEnergy: maxEnergy,
      speed: Number((rawSpeed * weightDef.speedMultiplier).toFixed(1)),
      power: Number(rawPower.toFixed(1)),
      armor: Number((rawArmor * weightDef.armorMultiplier).toFixed(1)),
      specialSkill: elementDef.specialSkillName,
    };
  }

  /**
   * Quản lý điểm Focus của Huấn luyện viên
   */
  function CoachFocusManager(options) {
    options = options || {};
    this.maxFocus = typeof options.maxFocus === 'number' ? options.maxFocus : 5;
    this.currentFocus = typeof options.initialFocus === 'number' ? options.initialFocus : 4;
    this.listeners = [];
  }

  CoachFocusManager.prototype.onFocusChange = function (callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
  };

  CoachFocusManager.prototype._notify = function () {
    for (var i = 0; i < this.listeners.length; i++) {
      try {
        this.listeners[i](this.currentFocus, this.maxFocus);
      } catch {
        // Safe callback execution
      }
    }
  };

  CoachFocusManager.prototype.getFocusCost = function (urgency) {
    return urgency === 'urgent_command' ? 2 : 1;
  };

  CoachFocusManager.prototype.canExecute = function (urgency) {
    var cost = this.getFocusCost(urgency);
    return this.currentFocus >= cost;
  };

  CoachFocusManager.prototype.consume = function (urgency) {
    var cost = this.getFocusCost(urgency);
    if (this.currentFocus >= cost) {
      this.currentFocus -= cost;
      this._notify();
      return true;
    }
    return false;
  };

  CoachFocusManager.prototype.recover = function (amount) {
    var add = typeof amount === 'number' ? amount : 1;
    if (this.currentFocus < this.maxFocus) {
      this.currentFocus = Math.min(this.maxFocus, this.currentFocus + add);
      this._notify();
    }
  };

  CoachFocusManager.prototype.reset = function () {
    this.currentFocus = this.maxFocus;
    this._notify();
  };

  var api = {
    WEIGHT_CLASSES: WEIGHT_CLASSES,
    ELEMENTAL_CORES: ELEMENTAL_CORES,
    ROBOT_PRESETS: ROBOT_PRESETS,
    QUICK_TACTICS: QUICK_TACTICS,
    getTotalAllocatedPoints: getTotalAllocatedPoints,
    validateLoadout: validateLoadout,
    calculateEffectiveStats: calculateEffectiveStats,
    CoachFocusManager: CoachFocusManager,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  global.AiChallengeHangar = api;
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
