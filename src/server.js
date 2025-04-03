const puppeteer = require('puppeteer');

const ollamaJs = require('ollama');
const { readFileSync } = require('node:fs');
const readline = require('readline');

class OllamaClient {
    constructor(aiSettings) {
        this.aiSettings = aiSettings;
        this.messages = [];
        this.client  = new ollamaJs.Ollama({ host: aiSettings.llmUrl });        
    }

    setup = async (setupPrompt) => {
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

const runScenario = async (ollamaClient, page, screenReaderOutput, scenarioStepObject) => {
    // Ask the AI for the action to take based on the screen reader output and instruction
    const response = await ollamaClient.send(`Here is the screen reader text you hear: ${screenReaderOutput}.\nHere is the instruction: ${scenarioStepObject.instruction}.\nWhat action would you take on the page?`)
    console.log(`Response: ${response}`);

    const successObject = scenarioStepObject.success;

    // Check if the step was successful
    switch (successObject?.condition) {
        case "responseIsEqual":
            if (response === scenarioStepObject.success.testValue) {
                console.log(`Step succeeded.`);
            } else {
                console.log(`Step failed.`);
                return "_failed";
            }
            break;
        case "responseIncludes":
            if (response.includes(scenarioStepObject.success.testValue)) {
                console.log(`Step succeeded.`);
            } else {
                console.log(`Step failed.`);
                return "_failed";
            }
            break;
        default:
            console.log(`Step succeeded.`);
            break;
    }

    // Perform any additional actions based on the step
    const { action, selector, value, valueType } = successObject?.onSuccess;
    
    switch (action) {
        case "click":
            const [element] = await page.waitForSelector(selector);
            if (element) {
                await element.click();
            }
            break;
        case "input":
            console.log("Inputting value...");
            console.log(`Selector: ${selector}`);
            console.log(`Value: ${value}`);
            console.log(`Value Type: ${valueType}`);
            const inputElement = await page.waitForSelector(selector);
            if (inputElement) {
                console.log(`Found input element for selector: ${selector}`);
                switch (valueType) {
                    case "text":
                        console.log(`Typing text value: "${value}"`);
                        await inputElement.type(value);
                        break;
                    case "number":
                        console.log(`Typing numeric value: ${value}`);
                        await inputElement.type(value.toString());
                        break;
                    case "email":
                        console.log(`Typing email value: "${value}"`);
                        await inputElement.type(value);
                        break;
                    case "password":
                        console.log(`Typing password value: "${value}"`);
                        await inputElement.type(value);
                        break;
                    case "checkbox":
                        const isChecked = await inputElement.evaluate(el => el.checked);
                        if (!isChecked) {
                            console.log(`Checkbox is unchecked. Clicking to check it.`);
                            await inputElement.click();
                        } else {
                            console.log(`Checkbox is already checked.`);
                        }
                        break;
                    case "radio":
                        console.log(`Clicking radio button.`);
                        await inputElement.click();
                        break;
                    case "file":
                        console.log(`Uploading file: "${value}"`);
                        if (inputElement) {
                            await inputElement.uploadFile(value);
                        } else {
                            console.log(`File input not found for XPath: ${xpath}`);
                        }
                        break;
                    case "select":
                        console.log(`Selecting value: "${value}"`);
                        await inputElement.select(value);
                        break;
                    default:
                        console.log(`Unknown valueType: "${valueType}". No action taken.`);
                }
            } else {
                console.log(`Input element not found for Selector: ${selector}`);
            }
            break;
        default:
            console.log(`No action taken for step ${scenarioStepObject.name}`);
    }

    return scenarioStepObject.nextStep;
}

(async () => {
    const ollamaClient = new OllamaClient({
        llmUrl: "http://localhost:11434",
        llmModel: "llama3.1"
    });

    await ollamaClient.setup("You are a visually disabled user who uses a screen reader.  You will be presented with the output of a screen reader and an instruction of what I want you to do on the page.  You will respond with the action you would take on the page.  You will only respond with the action you would take.  Do not include any other information in your response.  The screen reader output will be in the format of 'Heading level 1, Main Heading' or 'Button, Submit'.");

    // Launch a new browser instance
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    console.log(typeof page); // Should output "object"
    console.log(Object.keys(page)); // Should include "$x"

    try {
        // Open the URL
        const url = 'http://localhost:3000'; // Replace with your desired URL
        await page.goto(url);

        // Get the HTML contents of the page
        // const pageSource = await page.content();

        let scenarioStepObject = readFileSync('./src/scenarios/scenario1.json', 'utf-8');
        scenarioStepObject = scenarioStepObject && JSON.parse(scenarioStepObject);

        let step = "_start";
        while (step && step !== "_end") {
            const stepObject = scenarioStepObject[step];
            console.log(`Step: ${step}`);
            if (!stepObject) {
                console.log(`No step found for ${step}`);
                break;
            }
            const accessibilityTree = await page.accessibility.snapshot();
            // Print the accessibility tree
            console.log(JSON.stringify(accessibilityTree, null, 2));
            // Print the screen reader output
            const screenReaderOutput = generateScreenReaderOutput(accessibilityTree);
            console.log('Screen Reader Output:\n');
            console.log(screenReaderOutput);

            step = await runScenario(ollamaClient, page, screenReaderOutput, stepObject);
        }

        console.log(`Scenario completed. Final step: ${step}`);

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
    } finally {
        // Close the browser
        // await browser.close();
    }
})();