/**
 * Lightweight custom select with fully styleable dropdown options.
 */
export function createCustomSelect({
  container,
  options,
  value,
  onChange,
  closeRoot = document,
}) {
  const trigger = container.querySelector('.custom-select-trigger');
  const labelEl = container.querySelector('.custom-select-label');
  const menu = container.querySelector('.custom-select-menu');
  const hiddenInput = container.querySelector('input[type="hidden"]');

  const optionEls = options.map((opt) => {
    const li = document.createElement('li');
    li.className = 'custom-select-option';
    li.role = 'option';
    li.dataset.value = opt.value;
    li.textContent = opt.label;
    li.tabIndex = -1;
    menu.appendChild(li);
    return li;
  });

  function getLabelForValue(val) {
    return options.find((o) => o.value === val)?.label ?? val;
  }

  function setValue(val, { notify = true } = {}) {
    hiddenInput.value = val;
    labelEl.textContent = getLabelForValue(val);

    for (const el of optionEls) {
      const selected = el.dataset.value === val;
      el.classList.toggle('selected', selected);
      el.setAttribute('aria-selected', String(selected));
    }

    if (notify && onChange) {
      onChange(val);
    }
  }

  function open() {
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    container.classList.add('open');
  }

  function close() {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    container.classList.remove('open');
  }

  function toggle() {
    if (trigger.disabled) {
      return;
    }
    if (menu.hidden) {
      open();
    } else {
      close();
    }
  }

  function setDisabled(disabled) {
    trigger.disabled = disabled;
    trigger.setAttribute('aria-disabled', String(disabled));
    container.classList.toggle('disabled', disabled);
    if (disabled) {
      close();
    }
  }

  trigger.addEventListener('click', (e) => {
    if (trigger.disabled) {
      return;
    }
    e.stopPropagation();
    toggle();
  });

  for (const el of optionEls) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      setValue(el.dataset.value);
      close();
      trigger.focus();
    });
  }

  const onCloseRootClick = () => {
    if (!menu.hidden) {
      close();
    }
  };

  const onCloseRootKeydown = (e) => {
    if (e.key === 'Escape' && !menu.hidden) {
      close();
      trigger.focus();
    }
  };

  closeRoot.addEventListener('click', onCloseRootClick);
  closeRoot.addEventListener('keydown', onCloseRootKeydown);

  setValue(value, { notify: false });

  return {
    get value() {
      return hiddenInput.value;
    },
    setValue(val) {
      setValue(val, { notify: false });
    },
    setDisabled(disabled) {
      setDisabled(disabled);
    },
    get input() {
      return hiddenInput;
    },
    destroy() {
      closeRoot.removeEventListener('click', onCloseRootClick);
      closeRoot.removeEventListener('keydown', onCloseRootKeydown);
    },
  };
}
