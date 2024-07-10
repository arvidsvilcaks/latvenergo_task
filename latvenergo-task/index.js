const express = require('express');
const bodyParser = require('body-parser');
const bodyParserXml = require('body-parser-xml');
const js2xmlparser = require('js2xmlparser');
const https = require('https');

const app = express();
const port = 3055;

// Initialize XML body parser
bodyParserXml(bodyParser);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.xml({
    limit: '1MB',   // Reject payload bigger than 1 MB
    xmlParseOptions: {
        normalize: true,     // Trim whitespace inside text nodes
        normalizeTags: true, // Transform tags to lowercase
        explicitArray: false // Only put properties in array if length > 1
    }
}));

// Helper function to parse incoming request body based on Content-Type
function parseRequestBody(req, res, next) {
    const contentType = req.headers['content-type'];
    if (contentType && contentType.includes('xml')) {
        // XML parsing is already handled by body-parser-xml
        next();
    } else {
        // Default to JSON parsing
        bodyParser.json()(req, res, next);
    }
}

// Helper function to format response based on Accept header
function formatResponse(req, res, next) {
    res.format({
        'application/json': () => {
            res.json(res.locals.responseBody);
        },
        'application/xml': () => {
            const xml = js2xmlparser.parse("response", res.locals.responseBody);
            res.type('application/xml').send(xml);
        },
        'default': () => {
            // Default to JSON if Accept header is not set or not recognized
            res.json(res.locals.responseBody);
        }
    });
}

// Logging middleware for incoming requests
app.use((req, res, next) => {
    const logEntry = {
        type: 'messageIn',
        body: JSON.stringify(req.body),
        method: req.method,
        path: req.originalUrl,
        dateTime: new Date().toISOString()
    };
    console.log('Incoming request:', logEntry);
    next();
});

// Error handling middleware for JSON parsing errors
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        const errorResponse = {
            type: 'messageOut',
            body: err.body,
            dateTime: new Date().toISOString(),
            fault: err.stack || 'No stack trace available'
        };
        console.log('Error response:', errorResponse);
        res.locals.responseBody = errorResponse;
        return formatResponse(req, res, next);
    }
    next(err); // Pass the error to the default error handler
});

// Logging middleware for outgoing responses
app.use((req, res, next) => {
    const originalJson = res.json;
    res.json = function(body) {
        const logEntryOut = {
            type: 'messageOut',
            body: JSON.stringify(body),
            dateTime: new Date().toISOString(),
            fault: body.code >= 400 ? (body.fault || 'No error occurred') : undefined // Set 'fault' only for error responses
        };
        console.log('Outgoing response:', logEntryOut);
        originalJson.call(this, body);
    };
    next();
});

// Search endpoint
app.post('/search', parseRequestBody, (req, res, next) => {
    let { query, page = 1 } = req.body;

    // Validate inputs
    let errorMessages = [];

    if (typeof query !== 'string') {
        errorMessages.push('Query must be a string.');
    } else if (query.length < 3 || query.length > 10) {
        errorMessages.push('Query length must be between 3 and 10 characters.');
    }

    if (typeof page !== 'number') {
        errorMessages.push('Page must be a number.');
    } else if (page < 1) {
        errorMessages.push('Page must be greater than or equal to 1.');
    }

    // If there are validation errors, return a 400 response with the errors
    if (errorMessages.length > 0) {
        const errorResponse = {
            code: 400,
            message: errorMessages.join(' ')
        };
        console.log('Validation error response:', errorResponse);
        res.locals.responseBody = errorResponse;
        return formatResponse(req, res, next);
    }

    const pageSize = 2;
    const skip = (page - 1) * pageSize;

    https.get(`https://dummyjson.com/products/search?q=${query}&limit=${pageSize}&skip=${skip}`, (response) => {
        let data = '';
        // A chunk of data has been received.
        response.on('data', (chunk) => {
            data += chunk;
        });

        // The whole response has been received.
        response.on('end', () => {
            try {
                const products = JSON.parse(data).products;

                // Transform data
                const transformedProducts = products.map(product => {
                    const discount = product.price * (product.discountPercentage / 100);
                    const finalPrice = (product.price - discount).toFixed(2);
                    return {
                        title: product.title,
                        description: product.description,
                        final_price: parseFloat(finalPrice)
                    };
                });

                res.locals.responseBody = transformedProducts;
                formatResponse(req, res, next);
            } catch (error) {
                console.error('Error parsing response:', error);
                const errorResponse = {
                    code: 500,
                    message: 'Failed to parse response from external API',
                    fault: error.stack || 'No stack trace available'
                };
                console.log('Error response:', errorResponse);
                res.locals.responseBody = errorResponse;
                formatResponse(req, res, next);
            }
        });

    }).on('error', (err) => {
        console.error('Error fetching data:', err);
        const errorResponse = {
            code: 500,
            message: 'Failed to fetch products from external API',
            fault: err.stack || 'No stack trace available'
        };
        console.log('Error response:', errorResponse);
        res.locals.responseBody = errorResponse;
        formatResponse(req, res, next);
    });
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}/`);
});
