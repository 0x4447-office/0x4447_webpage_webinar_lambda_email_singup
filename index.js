let AWS = require("aws-sdk");
let ical = require('ical-generator');
let mustache = require('mustache');

//
//	Bringing S3 to life.
//
let s3 = new AWS.S3({
	apiVersion: '2006-03-01'
});

//
//	Load all the email templates.
//
let templates = require('./assets/templates/index');

//
//	This lambda is responsible for being invoked by S3, load up the Object, 
//	and send out an email, based on the data found in the JSON file.
//
exports.handler = (event) => {

	return new Promise(function(resolve, reject) {

		//
		//	1. This container holds all the data to be passed around the chain.
		//
		let container = {
			req: {
				bucket_name: event.Records[0].s3.bucket.name,
				escaped_key: event.Records[0].s3.object.key
			},
			emails:{
				we: process.env.EMAIL_WE
			},
			templates: templates,
			unescaped_key: null,
			//
			//	Storing here the S3 object.
			//
			message: {
				organizer: {},
				atendee: {}
			},
			//
			//	The default response for Lambda.
			//
			res: {
                message: "OK"
            }
		}

		//
		//	->	Start the chain.
		//
		unescape_key(container)
			.then(function(container) {

				return load_object(container);

			}).then(function(container) {

				return write_message_to_self(container);

			}).then(function(container) {

				return save_object_to_self(container);

			}).then(function(container) {

				return get_webinar_date(container);

			}).then(function(container) {

				return make_ical(container);

			}).then(function(container) {

				return write_message_to_user(container);

			}).then(function(container) {

				return save_object_to_user(container);

			}).then(function(container) {

				//
				//  ->  Send back the good news.
				//
				return resolve(container.res);

			}).catch(function(error) {

				//
				//	->	Stop and surface the error.
				//
				return reject(error);

			});
	});
};

//	 _____    _____     ____    __  __   _____    _____   ______    _____
//	|  __ \  |  __ \   / __ \  |  \/  | |_   _|  / ____| |  ____|  / ____|
//	| |__) | | |__) | | |  | | | \  / |   | |   | (___   | |__    | (___
//	|  ___/  |  _  /  | |  | | | |\/| |   | |    \___ \  |  __|    \___ \
//	| |      | | \ \  | |__| | | |  | |  _| |_   ____) | | |____   ____) |
//	|_|      |_|  \_\  \____/  |_|  |_| |_____| |_____/  |______| |_____/
//

//
//	We need to process the path received by S3 since AWS dose escape
//	the string in a special way. They escape the string in a HTML style
//	but for whatever reason they convert spaces in to +ses.
//
function unescape_key(container)
{
	return new Promise(function(resolve, reject) {

		console.info("unescape_key");

		//
		//	1.	First we convert the + in to spaces.
		//
		let plus_to_space = container.req.escaped_key.replace(/\+/g, ' ');

		//
		//	2.	And then we unescape the string, other wise we lose
		//		real + characters.
		//
		let unescaped_key = decodeURIComponent(plus_to_space);

		//
		//	3.	Save the result for the next promise.
		//
		container.unescaped_key = unescaped_key;

		//
		//	->	Move to the next chain.
		//
		return resolve(container);

	});
}

//
//	In this step we are going to load the object which trigerd this lamda,
//	so we can see what type of misteries are hiddin in it.
//
function load_object(container)
{
	return new Promise(function(resolve, reject) {

		console.info("load_object");
		
		//
		//	1.	Prepare the query.
		//
		let params = {
			Bucket: container.req.bucket_name,
			Key: container.unescaped_key
		};

		//
		//	-> Execute the query.
		//
		s3.getObject(params, function (error, data) {

			//
			//	1.	Check for internal errors.
			//
			if(error)
			{
				console.info(params);
				return reject(error);
			} 

			//
			//	2.	Save the object for the next promise.
			//
			container.user_details = JSON.parse(data.Body.toString());
			
			//
			//	->	Move to the next promise.
			//
			return resolve(container);
		
		});

	});
}

//
//	Generate the content of the email to myself so I can get a notification 
//	when someone sings up.
//
function write_message_to_self(container)
{
	return new Promise(function(resolve, reject) {

		console.info("write_message_to_self");
		
		//
		//	1.	Convert the S3 payload in to a string and jsut use it as it is
		//		since we don't need anything fancy for ourselfs.
		//
		let user_details = JSON.stringify(container.user_details, null, 4);
		
		//
		//	2.	Prepare the data to be replaced.
		//
		let data = {
			user_details: user_details
		}

		//
		//	3.	Render the message.
		//
		let message = mustache.render(container.templates.organizer.text, data);

		//
		//	4.	Save it for the next promise.
		//
		container.message.organizer = {
			subject: container.templates.organizer.subject,
			body: message,
			emails: {
				to: {
					name: "David Gatti",
					email: container.emails.we
				}
			}
		}

		//
		//	->	Move to the next promise.
		//
		return resolve(container);
		
	});
}

//
//	Then I take the message and save it to SMTP S3 to be sent out by SNS.
//
function save_object_to_self(container)
{
	return new Promise(function(resolve, reject) {

		console.info("save_object_to_self");
		
		//
		//	1.	Prepare the query.
		//
		let params = {
			Bucket: '0x4447-web-us-east-1-smtp',
			Key: Date.now() + '.json',
			Body: JSON.stringify(container.message.organizer)
		};

		//
		//	-> Execute the query.
		//
		s3.putObject(params, function (error, data) {

			//
			//	1.	Check for internal errors.
			//
			if(error)
			{
				console.info(params);
				return reject(error);
			} 
			
			//
			//	->	Move to the next promise.
			//
			return resolve(container);
		
		});

	});
}

//
//	Get webinar data, in this case we are interested in the time the
//	webinar starts so we can add the time to the ical file.
//
function get_webinar_date(container)
{
	return new Promise(function(resolve, reject) {

		console.info("get_webinar_date");
		
		//
		//	1.	Prepare the query.
		//
		let params = {
			Bucket: 'webinars.0x4447.com.db.events',
			Key: 'event.json'
		};

		//
		//	-> Execute the query.
		//
		s3.getObject(params, function (error, data) {

			//
			//	1.	Check for internal errors.
			//
			if(error)
			{
				console.info(params);
				return reject(error);
			} 

			//
			//	2.	Save the object for the next promise.
			//
			container.event = JSON.parse(data.Body.toString());
			
			//
			//	->	Move to the next promise.
			//
			return resolve(container);
		
		});

	});
}

//
//	Generate a iCal file with all the data of the event.
//
function make_ical(container)
{
	return new Promise(function(resolve, reject) {

		console.info("make_ical");
		
		//
		//	1.	Initialize iCal
		//
		let cal = ical({
			domain: '0x4447.com',
			prodId: {
				company: '0x4447.com', 
				product: 'webinars'
			},
			name: '0x4447 Webinar',
			timezone: 'Europe/Berlin',
			
		});

		//
		//	2.	Set some basic info about the file.
		//
		cal.prodId({
			company: '0x4447',
			product: 'Webinar',
			language: 'EN'
		});

		//
		//
		//
		container.event.first_name = container.user_details.first_name;

		//
		//	3.	Create the description of the iCal file.
		//
		let description = mustache.render(container.templates.calendar.text, container.event);

		//
		//	4.	Set the bulk of the event with all the data.
		//
		let event = cal.createEvent({
			start: container.event.time.start,
			end: container.event.time.end,
			summary: container.event.summary,
			description: description,
			organizer: 'David Gatti <david@0x4447.com>'
		});

		//
		//	5.	Create the Chime attendee with the meeting ID to help different
		//		tools and devices to auto connect.
		//
		let pin_email = 'pin+' + container.event.meeting_id + '@chime.aws'

		//
		//	6.	Add all the atendees of the meeting.
		//
		event.createAttendee({ email: 'meet@chime.aws', name: 'Chime' });
		event.createAttendee({ email: pin_email, name: 'PIN' });
		event.createAttendee({
			email: container.user_details.email, 
			name: container.user_details.first_name, 
			rsvp: true 
		});
		
		//
		//	7.	Set when the callendar app should notificy about the event.
		//
		event.createAlarm({
			type: 'audio',
			trigger: 300 * 6, // 30min before event
		});

		//
		//	8.	Convert the file in to a Base64 so we can attach it to the 
		//		email message payload.
		//
		container.ics = Buffer.from(cal.toString()).toString('base64');

		//
		//	->	Move to the next promise.
		//
		return resolve(container);
		

	});
}

//
//	With the iCal file done, we can make the email message for the user who
//	singed up to the webinar.
//
function write_message_to_user(container)
{
	return new Promise(function(resolve, reject) {

		console.info("write_message_to_user");

		//
		//	1.	Create the full name of the reseller.
		//
		let full_name = container.user_details.first_name 
					  + " " 
					  + container.user_details.last_name;
		

		//
		//	2.	Render the message.
		//
		let message = mustache.render(container.templates.atendee.text, container.event);

		//
		//	3.	Save it for the next promise.
		//
		container.message_user = {
			subject: container.templates.atendee.subject,
			body: message,
			emails: {
				to: {
					name: full_name,
					email: container.user_details.email
				}
			},
			attachments: [
				{
					filename: 'event.ics',
					content: container.ics,
					encoding: 'base64'
				}
			]
		}

		//
		//	->	Move to the next promise.
		//
		return resolve(container);

	});
}

//
//	Finally save the user email to S3 to be sent out.
//
function save_object_to_user(container)
{
	return new Promise(function(resolve, reject) {

		console.info("save_object_to_user");
		
		//
		//	1.	Prepare the query.
		//
		let params = {
			Bucket: '0x4447-web-us-east-1-smtp',
			Key: Date.now() + '.json',
			Body: JSON.stringify(container.message_user)
		};

		//
		//	-> Execute the query.
		//
		s3.putObject(params, function (error, data) {

			//
			//	1.	Check for internal errors.
			//
			if(error)
			{
				console.info(params);
				return reject(error);
			} 
			
			//
			//	->	Move to the next promise.
			//
			return resolve(container);
		
		});

	});
}