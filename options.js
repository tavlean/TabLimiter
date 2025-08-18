const browser = chrome || browser

const tabQuery = (options, params = {}) => new Promise(res => {
	if (!options.countPinnedTabs) params.pinned = false // only non-pinned tabs
	browser.tabs.query(params, tabs => res(tabs))
})

const windowRemaining = options =>
	tabQuery(options, { currentWindow: true })
		.then(tabs => options.maxWindow - tabs.length)

const totalRemaining = options =>
	tabQuery(options)
		.then(tabs => options.maxTotal - tabs.length)

// Badge updates are handled by the background script
const updateBadge = options => {
	// Send message to background script to update badge
	browser.runtime.sendMessage({ action: 'updateBadge', options });
}

// ----------------------------------------------------------------------------

let $inputs;



// Saves options to browser.storage
const saveOptions = () => {

	const values = {};

	for (let i = 0; i < $inputs.length; i++) {
		const input = $inputs[i];

		const value =
			input.type === "checkbox" ?
			input.checked :

			input.value;

		values[input.id] = value;
	}

	const options = values;

	browser.storage.sync.set(options, () => {

		// Update status to let user know options were saved.
		const status = document.getElementById('status');
		status.className = 'notice';
		status.textContent = 'Options saved.';
		setTimeout(() => {
			status.className += ' invisible';
		}, 100);


		updateBadge(options)
	});
}

// Restores select box and checkbox state using the preferences
// stored in browser.storage.
const restoreOptions = () => {
	browser.storage.sync.get("defaultOptions", (defaults) => {
		browser.storage.sync.get(defaults.defaultOptions, (options) => {

			for (let i = 0; i < $inputs.length; i++) {
				const input = $inputs[i];

				const valueType =
					input.type === "checkbox" ?
					"checked" :
					"value";

				input[valueType] = options[input.id];
			};
		});
	});
}

document.addEventListener('DOMContentLoaded', () => {
	restoreOptions();

	$inputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');

	const onChangeInputs = document.querySelectorAll('input[type="checkbox"], input[type="number"]');
	const onKeyupInputs = document.querySelectorAll('input[type="number"]');

	for (let i = 0; i < onChangeInputs.length; i++) {
		onChangeInputs[i].addEventListener('change', saveOptions);
	}
	for (let i = 0; i < onKeyupInputs.length; i++) {
		onKeyupInputs[i].addEventListener('keyup', saveOptions);
	}

	// Stepper button functionality
	const stepperButtons = document.querySelectorAll('.stepper-btn');
	stepperButtons.forEach(button => {
		button.addEventListener('click', () => {
			const inputId = button.dataset.input;
			const action = button.dataset.action;
			const input = document.getElementById(inputId);
			const currentValue = parseInt(input.value) || 1;
			const min = parseInt(input.min) || 1;
			const max = parseInt(input.max) || 1337;
			
			let newValue;
			if (action === 'increment') {
				newValue = Math.min(currentValue + 1, max);
			} else {
				newValue = Math.max(currentValue - 1, min);
			}
			
			input.value = newValue;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
	});


	// show special message
	if (!localStorage.getItem('readMessage') && (new Date() < new Date('09-20-2020'))) {
		document.querySelector('.message').classList.remove('hidden')
		setTimeout(() => {
			localStorage.setItem('readMessage', true)
		}, 2000);
	}
});




