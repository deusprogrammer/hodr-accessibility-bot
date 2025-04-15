const puppeteer = require('puppeteer');

const ollamaJs = require('ollama');
const { readFileSync } = require('node:fs');
const readline = require('readline');

const roleMap = {
    "Heading level 1": "h1",
    "Heading level 2": "h2",
    "Heading level 3": "h3",
    "Heading level 4": "h4",
    "Heading level 5": "h5",
    "Heading level 6": "h6",
    "Button": "button",
    "Textbox": "input[type='text'], input[type='email'], input[type='password'], textarea",
    "Link": "a"
}

const setupPrompt = `
    You are a visually disabled user who uses a screen reader.
    You will be presented with the output of a screen reader and an instruction of what I want you to do on the page.
    You will respond with the actions you would take on the page to perform the task I give you.
    You will only respond with the actions you would take in JSON format.
    The response payload should include an array of the actions you took in the order you took them, and each element of the array show be a JSON object containing the action you performed (with the key 'action'), the role of the element you performed the action on  (with the key 'role'), the target text/label of the element you performed the action on  (with the key 'target'), and lastly the value (when the action is 'type', this is the text you typed, when it's 'click' it's the mouse button you clicked)(with the key 'value').  Acceptable actions are 'click' and 'type'.  Do not include any other information in your response.
    When filling out forms, please ensure you are clicking on form inputs and then typing in them.
    Also please be sure you are responding with the correct roles.  In the past when I have given you this prompt you have responded with the wrong roles or non-existent element role combos.  For instance you keep trying to click on elements that are not actually buttons, but rather are text boxes.
    Do not include any other information other than the JSON array I described above.  In previous conversations you have included other information in your response, but I only want the JSON array.
    You do not need to scroll the page as you are a screen reader user and you can only hear the elements on the page.  I realize that a screen reader user would be tabbing through the page, but for the purposes of this exercise, you can click on elements rather than using space bar to select them.

    Screen reader text will be in the format of: <Role>, <Target>

    The following is an example of screen reader text you might hear:
        RootWebArea, React App
            Heading level 1, Header Text
            Heading level 2, Subheader Text
            Button, Submit
            Textbox, Username
            Textbox, Password
            Button, Login
            Button, Cancel
            Link, Forgot Password?

    In the response JSON please extract the role and target from the screen reader text and use them as the role and target in the JSON response.  The action should be either 'click' or 'type' depending on what you are doing with the element.  The value should be the value you are typing into the element if it is a type action, or the mouse button you are clicking with if it is a click action.

    For example, if you were going to click on the element represented by the screen reader text "Button, Submit", type "myusername" into the element represented by the screen reader text "Textbox, Username", and then click on the element represented by the screen reader text "Button, Submit" , you would respond with:
    [
        {
            "action": "click",
            "role": "Button",
            "target": "Submit",
            "value": "leftMouseButton"
        },
        {
            "action": "type",
            "role": "Textbox",
            "target": "Username",
            "value": "myusername"
        },
        {
            "action": "click",
            "role": "Button",
            "target": "Submit",
            "value": "leftMouseButton"
        }
    ]

    Also just for fun, add a comment field to each action object in the JSON array that describes what you are doing with the element.  For example, if you are clicking on a button, the comment field should say "Clicking on the button".  If you are typing into a text box, the comment field should say "Typing into the text box".  Do not include this comment field in your response JSON.  This is just for me to understand what you are doing with each element.
    `;

class OllamaClient {
    constructor(aiSettings) {
        this.aiSettings = aiSettings;
        this.messages = [];
        this.client  = new ollamaJs.Ollama({ host: aiSettings.llmUrl });
    }

    setup = async (setupPrompt) => {
        this.messages = [];
        this.messages.push({
            role: "system",
            content: setupPrompt
        });
        await this.client.chat({
            stream: false,
            model: this.aiSettings.llmModel,
            messages: this.messages
        });
    }

    send = async (message) => {
        this.messages.push({
            role: "user",
            content: `${message}`
        });
        let response = await this.client.chat({
            stream: false,
            model: this.aiSettings.llmModel,
            messages: this.messages
        });
        this.messages.push(response.message);
        return response.message.content;
    }
}

function printPretty(char, padding, ...lines) {
    // Calculate the maximum line length
    const maxLength = Math.max(...lines.map(line => line.length));

    // Create the top and bottom border
    const border = char.repeat(maxLength + padding * 2 + 2);

    // Create the padded lines
    const paddedLines = lines.map(line => {
        const paddingSpaces = ' '.repeat(padding);
        const extraSpaces = ' '.repeat(maxLength - line.length); // Ensure all lines are the same width
        const paddedLine = `${paddingSpaces}${line}${extraSpaces}${paddingSpaces}`;
        return `${char}${paddedLine}${char}`;
    });

    // Combine everything into the ASCII box
    console.log([border, ...paddedLines, border].join('\n'));
    console.log('\n');
}

// Function to recursively process the accessibility tree
function generateScreenReaderOutput(node, depth = 0) {
    if (!node) return '';

    // Extract relevant information
    const { role, name, description, children, level } = node;

    // Build the output for the current node
    let output = '';
    if (role) {
        // Start with the role
        output += `${'  '.repeat(depth)}`;

        // Handle specific roles with screen reader-like phrasing
        switch (role) {
            case 'heading':
                output += `Heading level ${level || 1}, ${name || 'Unnamed heading'}`;
                break;
            case 'button':
                output += `Button, ${name || 'Unnamed button'}`;
                break;
            case 'link':
                output += `Link, ${name || 'Unnamed link'}`;
                break;
            case 'text':
                output += `${name || description || ''}`; // Text content is usually read directly
                break;
            case 'checkbox':
                output += `Checkbox, ${name || 'Unnamed checkbox'}`;
                break;
            case 'radio':
                output += `Radio button, ${name || 'Unnamed radio button'}`;
                break;
            case 'textbox':
                output += `Textbox, ${name || 'Unnamed textbox'}`;
                break;
            default:
                output += `${role.charAt(0).toUpperCase() + role.slice(1)}, ${name || 'Unnamed'}`;
        }

        // Add description if available
        if (description) {
            output += `, ${description}`;
        }

        output += '\n';
    }

    // Recursively process child nodes
    if (children && children.length > 0) {
        for (const child of children) {
            output += generateScreenReaderOutput(child, depth + 1);
        }
    }

    return output;
}

const checkAction = (actionElement, test) => {
    for (let key in test.testValue){
        if (key === 'description') {
            return true;
        }

        if (actionElement[key] !== test.testValue[key]) {
            return false;
        }
    };
    return true;
}

const runScenario = async (ollamaClient, page, screenReaderOutput, step, stepName) => {
    await ollamaClient.setup(setupPrompt);

    // Ask the AI for the action to take based on the screen reader output and instruction
    let response;
    response = await ollamaClient.send(`Here is the screen reader text you hear: ${screenReaderOutput}.\nHere is your task: ${step.instruction}.\nPlease generate the JSON array of actions you would take on the page to perform the task I gave you.  Do not include any other information in your response.`);

    try {
        response = JSON.parse(response);
    } catch (error) {
        response = await ollamaClient.send(`No, I said not to include any other information in your response.  I only want the JSON array I described in the initial prompt.  Here is the screen reader text you hear: ${screenReaderOutput}.\nHere is the instruction: ${step.instruction}.\nWhat action would you take on the page?`);
        try {
            response = JSON.parse(response);
        } catch (error) {
            throw new Error(`The AI is stupid and didn't follow the instructions.`);
        }
    }

    const successObject = step.success;

    console.log("\tPerforming actions on the page:");
    for (let actionElement of response) {
        const element = await page.evaluateHandle(({actionElement, roleMap}) => {
            return Array.from(document.querySelectorAll(roleMap[actionElement.role])).find(
                el => el.textContent.includes(actionElement.target) || el.attributes.getNamedItem('aria-label')?.value.includes(actionElement.target) || el.attributes.getNamedItem('placeholder')?.value.includes(actionElement.target)
            );
        }, { actionElement, roleMap});

        if (!element) {
            console.log(`\t\tElement not found for action: ${actionElement.role}, ${actionElement.target}`);
            continue;
        }

        // Act on the element
        try {
            switch (actionElement.action) {
                case "click":
                    console.log(`\t\tClicking on element: ${actionElement.role}, ${actionElement.target}`);
                    await element.click();
                    break;
                case "type":
                    console.log(`\t\tTyping value: ${actionElement.value} into element: ${actionElement.role}, ${actionElement.target}`);
                    await element.type(actionElement.value);
                    break;
                default:
                    console.log(`\t\tUnknown action: ${actionElement.action}`);
                    break;
            }
        } catch (error) {
            console.error(`\t\t\x1b[31mFailed to ${actionElement.action} on element: ${actionElement.role}, ${actionElement.target}\x1b[0m`);
        }
    }

    console.log("\tTest results:");
    // Check if the step was successful
    for (let test of successObject) {
        try {
            switch (test?.condition) {
                case "responseIsEqual":
                    if (JSON.stringify(response) !== test.testValue) {
                        throw new Error('test failed');
                    }
                    break;
                case "responseIncludes":
                    if (!JSON.stringify(response).includes(test.testValue)) {
                        throw new Error('test failed');
                    }
                    break;
                case "actionTaken":
                    let testPassed = false;
                    for (let actionElement of response) {
                        if (checkAction(actionElement, test)) {
                            testPassed = true;
                            break;
                        }
                    }
                    if (!testPassed) {
                        throw new Error('test failed');
                    }
                    break;
            }
        } catch (err) {
            console.log(`\t\t\x1b[31m'${test.description}': failed.\x1b[0m`);
            return "_failed";
        }

        console.log(`\t\t\x1b[32m'${test.description}': succeeded.\x1b[0m`);

        // Perform any additional actions based on the step
        const { action, selector, value, valueType } = test?.onSuccess || {};
    
        switch (action) {
            case "click":
                const [element] = await page.waitForSelector(selector);
                if (element) {
                    await element.click();
                }
                break;
            case "input":
                const inputElement = await page.waitForSelector(selector);
                if (inputElement) {
                    switch (valueType) {
                        case "text":
                            console.log(`\t\t\tTyping text value: "${value}"`);
                            await inputElement.type(value);
                            break;
                        case "number":
                            console.log(`\t\t\tTyping numeric value: ${value}`);
                            await inputElement.type(value.toString());
                            break;
                        case "email":
                            console.log(`\t\t\tTyping email value: "${value}"`);
                            await inputElement.type(value);
                            break;
                        case "password":
                            console.log(`\t\t\tTyping password value: "${value}"`);
                            await inputElement.type(value);
                            break;
                        case "checkbox":
                            const isChecked = await inputElement.evaluate(el => el.checked);
                            if (!isChecked) {
                                console.log(`\t\t\tCheckbox is unchecked. Clicking to check it.`);
                                await inputElement.click();
                            } else {
                                console.log(`\t\t\tCheckbox is already checked.`);
                            }
                            break;
                        case "radio":
                            console.log(`\t\t\tClicking radio button.`);
                            await inputElement.click();
                            break;
                        case "file":
                            console.log(`\t\t\tUploading file: "${value}"`);
                            if (inputElement) {
                                await inputElement.uploadFile(value);
                            } else {
                                console.log(`File input not found for XPath: ${xpath}`);
                            }
                            break;
                        case "select":
                            console.log(`\t\t\tSelecting value: "${value}"`);
                            await inputElement.select(value);
                            break;
                        default:
                            console.log(`\t\t\tUnknown valueType: "${valueType}". No additional action taken on success.`);
                    }
                } else {
                    console.log(`\t\t\tInput element not found for Selector: ${selector}.  No additional action taken on success`);
                }
                break;
            default:
                console.log(`\t\t\tNo additional action taken on success`);
                break;
        }
    }

    return step.next;
}

(async () => {
    const args = process.argv.slice(2);

    const scenarioFilePath = args[0];

    if (!scenarioFilePath) {
        console.error('Please provide a scenario file path as an argument.');
        process.exit(1);
    }

    // Launch a new browser instance
    const browser = await puppeteer.launch(
        {
            headless: false,
            args: ['--start-fullscreen'], // Launch the browser in fullscreen mode
            defaultViewport: null 
        }
    );
    const page = await browser.newPage();

    let testDefinition = readFileSync(scenarioFilePath, 'utf-8');
    testDefinition = testDefinition && JSON.parse(testDefinition);

    const {llmUrl, llmModel, steps} = testDefinition;

    printPretty(
        '*',
        2,
        `Running scenario: ${scenarioFilePath}`,
        `Using model ${llmModel} at ${llmUrl}`
    );
    const ollamaClient = new OllamaClient({
        llmUrl,
        llmModel
    });

    try {
        let url;

        let step = "_start";
        while (step && step !== "_end" && step !== "_failed") {
            const stepObject = steps[step];
            if (stepObject?.url) {
                url = stepObject.url;
                await page.goto(url);
            }

            if (!url) {
                console.log(`No URL set!`);
                break;
            }

            // console.log(`\nCurrent URL: ${url}`);
            // console.log(`Step: ${step}`);
            if (!stepObject) {
                console.log(`No step found for ${step}`);
                break;
            }
            printPretty('*', 2, `Instruction: ${stepObject?.instruction}`);
            const accessibilityTree = await page.accessibility.snapshot();
            // console.log(JSON.stringify(accessibilityTree, null, 2));
            const screenReaderOutput = generateScreenReaderOutput(accessibilityTree);
            // console.log('Screen Reader Output:\n');
            // console.log(screenReaderOutput);

            step = await runScenario(ollamaClient, page, screenReaderOutput, stepObject, step);
            console.log('\n');
        }

        if (step === "_failed") {
            printPretty('*', 2, `Scenario failed.`);
        } else if (step === "_end") {
            printPretty('*', 2, `Scenario completed. Final step: ${step}`);
        } else {
            printPretty('*', 2, `Scenario failed. Unknown final step: ${step}`);
        }
        // Wait for user input
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question('Press Enter to close...', async () => {
            rl.close();
            await browser.close();
        });
    } catch (error) {
        console.error('Error:', error);
    }
})();